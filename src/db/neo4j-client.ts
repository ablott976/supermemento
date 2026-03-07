import json
import uuid
from datetime import datetime
from typing import Any, Optional, TypedDict, cast, List, Dict
from neo4j import AsyncDriver, AsyncGraphDatabase
from neo4j.graph import Node
from ..config import AppConfig
from ..types.enums import DocumentStatus, MemoryType, RelationType
from ..services.search.types import SearchFilters, FilterOperator, VectorSearchResult


class Neo4jClient:
    """Async Neo4j client with vector search capabilities."""
    
    def __init__(self, uri: str, user: str, password: str):
        self.driver = AsyncGraphDatabase.driver(uri, auth=(user, password))
        self._vector_index_name = "chunk_embeddings"
    
    async def close(self) -> None:
        """Close the driver connection."""
        await self.driver.close()
    
    async def verify_connectivity(self) -> bool:
        """Verify connection to Neo4j database."""
        try:
            await self.driver.verify_connectivity()
            return True
        except Exception:
            return False
    
    async def vector_search_with_filters(
        self,
        query_embedding: List[float],
        top_k: int = 10,
        filters: Optional[SearchFilters] = None,
        index_name: Optional[str] = None
    ) -> List[VectorSearchResult]:
        """
        Perform vector similarity search with optional metadata filters.
        Uses Neo4j vector index (db.index.vector.queryNodes) with additional filtering applied to results.
        Falls back to brute-force cosine similarity if vector index is not available.
        
        Args:
            query_embedding: The vector embedding to search against
            top_k: Number of results to return
            filters: Optional filters to apply to metadata fields
            index_name: Optional custom vector index name
            
        Returns:
            List of VectorSearchResult containing nodes and similarity scores
            
        Raises:
            ValueError: If query_embedding is empty or invalid
        """
        if not query_embedding:
            raise ValueError("query_embedding cannot be empty")
        
        idx_name = index_name or self._vector_index_name
        
        # Build filter clauses and parameters
        where_clauses = []
        params: Dict[str, Any] = {
            "embedding": query_embedding,
            "top_k": top_k,
            "index_name": idx_name
        }
        
        if filters:
            # Handle standard filters
            if filters.get("document_id"):
                where_clauses.append("c.document_id = $document_id")
                params["document_id"] = filters["document_id"]
            
            if filters.get("memory_type"):
                where_clauses.append("c.memory_type = $memory_type")
                params["memory_type"] = filters["memory_type"]
            
            if filters.get("status"):
                where_clauses.append("c.status = $status")
                params["status"] = filters["status"]
            
            # Handle metadata filters (arbitrary key-value pairs)
            if filters.get("metadata"):
                for key, value in filters["metadata"].items():
                    param_key = f"meta_{key}"
                    where_clauses.append(f"c.{key} = ${param_key}")
                    params[param_key] = value
            
            # Handle custom filter conditions with operators
            if filters.get("custom_filters"):
                for i, filter_cond in enumerate(filters["custom_filters"]):
                    field = filter_cond["field"]
                    op = filter_cond["operator"]
                    value = filter_cond["value"]
                    param_key = f"custom_filter_{i}"
                    params[param_key] = value
                    
                    if op == FilterOperator.EQ:
                        where_clauses.append(f"c.{field} = ${param_key}")
                    elif op == FilterOperator.NE:
                        where_clauses.append(f"c.{field} <> ${param_key}")
                    elif op == FilterOperator.GT:
                        where_clauses.append(f"c.{field} > ${param_key}")
                    elif op == FilterOperator.GTE:
                        where_clauses.append(f"c.{field} >= ${param_key}")
                    elif op == FilterOperator.LT:
                        where_clauses.append(f"c.{field} < ${param_key}")
                    elif op == FilterOperator.LTE:
                        where_clauses.append(f"c.{field} <= ${param_key}")
                    elif op == FilterOperator.IN:
                        where_clauses.append(f"c.{field} IN ${param_key}")
                    elif op == FilterOperator.CONTAINS:
                        where_clauses.append(f"c.{field} CONTAINS ${param_key}")
        
        # Construct WHERE clause
        filter_clause = ""
        if where_clauses:
            filter_clause = "WHERE " + " AND ".join(where_clauses)
        
        # If filters are present, use brute force to ensure accurate filtering
        # Otherwise use vector index for better performance
        if filters:
            return await self._brute_force_search(query_embedding, top_k, filter_clause, params)
        else:
            return await self._vector_index_search(query_embedding, top_k, idx_name, params)
    
    async def _vector_index_search(
        self,
        query_embedding: List[float],
        top_k: int,
        index_name: str,
        params: Dict[str, Any]
    ) -> List[VectorSearchResult]:
        """
        Search using Neo4j vector index.
        """
        query = """
        CALL db.index.vector.queryNodes($index_name, $top_k, $embedding)
        YIELD node, score
        WITH node as c, score
        RETURN c {
            .*,
            embedding: null
        } as node_data,
        score
        ORDER BY score DESC
        """
        
        async with self.driver.session() as session:
            try:
                result = await session.run(query, params)
                records = await result.data()
                
                return [
                    VectorSearchResult(
                        node=record["node_data"],
                        score=record["score"]
                    )
                    for record in records
                ]
            except Exception as e:
                # Fall back to brute force if vector index fails
                return await self._brute_force_search(
                    query_embedding, top_k, "", params
                )
    
    async def _brute_force_search(
        self,
        query_embedding: List[float],
        top_k: int,
        filter_clause: str,
        params: Dict[str, Any]
    ) -> List[VectorSearchResult]:
        """
        Brute force cosine similarity search with filters.
        Calculates cosine similarity manually for maximum compatibility.
        """
        # Manual cosine similarity calculation with null safety
        query = f"""
        MATCH (c:Chunk)
        {filter_clause}
        WITH c, c.embedding as emb
        WHERE emb IS NOT NULL AND size(emb) = size($embedding)
        WITH c,
             reduce(dot = 0.0, i in range(0, size(emb)-1) | dot + emb[i] * $embedding[i]) as dot_product,
             sqrt(reduce(x = 0.0, i in range(0, size(emb)-1) | x + emb[i] * emb[i])) as norm_c,
             sqrt(reduce(y = 0.0, i in range(0, size($embedding)-1) | y + $embedding[i] * $embedding[i])) as norm_q
        WITH c, 
             CASE WHEN norm_c > 0 AND norm_q > 0 THEN dot_product / (norm_c * norm_q) ELSE 0 END as score
        WHERE score > 0
        RETURN c {{
            .*,
            embedding: null
        }} as node_data,
        score
        ORDER BY score DESC
        LIMIT $top_k
        """
        
        async with self.driver.session() as session:
            result = await session.run(query, params)
            records = await result.data()
            
            return [
                VectorSearchResult(
                    node=record["node_data"],
                    score=record["score"]
                )
                for record in records
            ]
