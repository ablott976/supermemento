import logging
from typing import Any, Optional, List, Dict, cast
from neo4j import AsyncGraphDatabase, AsyncDriver
from neo4j.exceptions import ServiceUnavailable, DatabaseError, ClientError, Neo4jError
from ..config import AppConfig
from ..types.enums import DocumentStatus, MemoryType, RelationType
from ..services.search.types import SearchFilters, FilterOperator, VectorSearchResult

logger = logging.getLogger(__name__)


class Neo4jClientError(Exception):
    """Base exception for Neo4j client errors."""
    pass


class VectorSearchError(Neo4jClientError):
    """Raised when vector search fails."""
    pass


class Neo4jClient:
    """Async Neo4j client with vector search capabilities."""
    
    def __init__(self, uri: str, user: str, password: str, timeout: Optional[float] = None):
        """
        Initialize Neo4j client.
        
        Args:
            uri: Neo4j connection URI
            user: Username
            password: Password
            timeout: Optional connection timeout in seconds
            
        Raises:
            ValueError: If connection parameters are invalid
            Neo4jClientError: If driver initialization fails
        """
        if not uri or not isinstance(uri, str):
            raise ValueError("Valid URI string is required")
        if not user or not isinstance(user, str):
            raise ValueError("Valid user string is required")
        if not password or not isinstance(password, str):
            raise ValueError("Valid password string is required")
            
        try:
            self.driver = AsyncGraphDatabase.driver(
                uri, 
                auth=(user, password), 
                connection_timeout=timeout or 30.0
            )
            self._vector_index_name = "chunk_embeddings"
            self._timeout = timeout
        except Exception as e:
            logger.error(f"Failed to initialize Neo4j driver: {e}")
            raise Neo4jClientError(f"Driver initialization failed: {e}") from e

    async def close(self) -> None:
        """Close the driver connection."""
        try:
            await self.driver.close()
        except Exception as e:
            logger.warning(f"Error closing Neo4j driver: {e}")
            # Don't raise to allow cleanup to continue

    async def verify_connectivity(self) -> bool:
        """
        Verify connection to Neo4j database.
        
        Returns:
            True if connection is successful, False otherwise
        """
        try:
            await self.driver.verify_connectivity()
            return True
        except ServiceUnavailable as e:
            logger.error(f"Neo4j service unavailable: {e}")
            return False
        except Exception as e:
            logger.error(f"Failed to verify Neo4j connectivity: {e}")
            return False

    def _validate_embedding(self, embedding: List[float]) -> None:
        """
        Validate embedding vector.
        
        Args:
            embedding: The embedding vector to validate
            
        Raises:
            ValueError: If embedding is invalid
        """
        if not isinstance(embedding, list):
            raise ValueError("query_embedding must be a list")
        if len(embedding) == 0:
            raise ValueError("query_embedding cannot be empty")
        if not all(isinstance(x, (int, float)) for x in embedding):
            raise ValueError("query_embedding must contain only numeric values")
        if any(isinstance(x, float) and (x != x or x == float('inf') or x == float('-inf')) for x in embedding):
            raise ValueError("query_embedding contains invalid float values (NaN or Inf)")

    def _build_filter_map(self, filters: Optional[SearchFilters]) -> Dict[str, Any]:
        """
        Build filter map for Neo4j vector search pre-filtering.
        Only includes equality filters suitable for db.index.vector.queryNodes.
        
        Args:
            filters: Optional search filters
            
        Returns:
            Dictionary of equality filters for Neo4j
        """
        filter_map: Dict[str, Any] = {}
        
        if not filters or not isinstance(filters, dict):
            return filter_map
        
        # Handle standard equality filters
        if filters.get("document_id"):
            doc_id =
