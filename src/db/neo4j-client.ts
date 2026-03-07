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
        
        Uses Neo4j vector index (db.index.vector.queryNodes) with additional
        filtering applied to results. Falls back to brute-force cosine similarity
        if vector index is not available.
        
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
        
        # Primary query using vector index
        query = f"""
        CALL db.index.vector.queryNodes($index_name, $top_k, $embedding)
        YIELD node AS c, score
        {filter_clause}
        RETURN c {{
            .*, 
            embedding: null
        }} AS node, score
        ORDER BY score DESC
        LIMIT $top_k
        """
        
        try:
            results = await self._execute_search_query(query, params)
            if results:
                return results
        except Exception as e:
            # Log error and fall through to fallback
            print(f"Vector index search failed, falling back: {e}")
        
        # Fallback: Brute force cosine similarity with filtering
        fallback_query = f"""
        MATCH (c:Chunk)
        {filter_clause}
        WITH c, 
             CASE 
                WHEN c.embedding IS NOT NULL 
                THEN vector.similarity.cosine(c.embedding, $embedding) 
                ELSE null 
             END AS score
        WHERE score IS NOT NULL
        ORDER BY score DESC
        LIMIT $top_k
        RETURN c {{
            .*,
            embedding: null
        }} AS node, score
        """
        
        return await self._execute_search_query(fallback_query, params)
    
    async def _execute_search_query(
        self, 
        query: str, 
        params: Dict[str, Any]
    ) -> List[VectorSearchResult]:
        """
        Execute Cypher query and format results.
        
        Args:
            query: Cypher query string
            params: Query parameters
            
        Returns:
            Formatted list of vector search results
        """
        async with self.driver.session() as session:
            result = await session.run(query, params)
            records = await result.data()
            
            formatted_results: List[VectorSearchResult] = []
            for record in records:
                node_data = record["node"]
                
                # Extract chunk ID from various possible field names
                chunk_id = node_data.get("chunk_id") or node_data.get("id") or ""
                content = node_data.get("content") or node_data.get("text") or ""
                
                # Build metadata excluding core fields
                metadata = {
