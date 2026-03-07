from typing import Any, Optional, List, Dict
from neo4j import AsyncGraphDatabase
from ..services.search.types import SearchFilters, VectorSearchResult


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
                where
