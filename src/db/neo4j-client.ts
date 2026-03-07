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
            doc_id = filters["document_id"]
            if isinstance(doc_id, str) and doc_id.strip():
                filter_map["document_id"] = doc_id
            elif isinstance(doc_id, (int, float)):
                filter_map["document_id"] = doc_id
            
        if filters.get("memory_type"):
            memory_type = filters["memory_type"]
            # Validate against enum if it's a string
            if isinstance(memory_type, str):
                try:
                    MemoryType(memory_type)
                except ValueError:
                    logger.warning(f"Invalid memory_type filter: {memory_type}")
            filter_map["memory_type"] = memory_type
            
        if filters.get("status"):
            status = filters["status"]
            if isinstance(status, str):
                try:
                    DocumentStatus(status)
                except ValueError:
                    logger.warning(f"Invalid status filter: {status}")
            filter_map["status"] = status
            
        # Handle metadata filters (arbitrary key-value pairs)
        if filters.get("metadata") and isinstance(filters["metadata"], dict):
            for key, value in filters["metadata"].items():
                if key and value is not None:
                    # Skip complex types for pre-filtering
                    if isinstance(value, (str, int, float, bool, list)):
                        filter_map[key] = value
                    else:
                        logger.debug(f"Skipping non-primitive metadata filter: {key}")
                        
        return filter_map

    def _apply_post_filters(
        self, 
        results: List[VectorSearchResult], 
        filters: Optional[SearchFilters]
    ) -> List[VectorSearchResult]:
        """
        Apply post-filtering for non-equality operators.
        
        Args:
            results: Initial search results
            filters: Search filters containing custom filter conditions
            
        Returns:
            Filtered results
        """
        if not filters or not isinstance(filters, dict):
            return results
            
        custom_filters = filters.get("custom_filters")
        if not custom_filters or not isinstance(custom_filters, list):
            return results
            
        filtered_results = results
        
        for filter_cond in custom_filters:
            if not isinstance(filter_cond, dict):
                continue
                
            field = filter_cond.get("field")
            operator = filter_cond.get("operator")
            value = filter_cond.get("value")
            
            if not field or operator is None:
                continue
                
            # Skip EQ as it was handled by pre-filtering
            if operator == FilterOperator.EQ:
                continue
                
            filtered_results = [
                result for result in filtered_results
                if self._matches_operator(result.node.get(field), operator, value)
            ]
            
            if not filtered_results:
                break  # Early exit if no matches remain
                
        return filtered_results

    def _matches_operator(self, field_value: Any, operator: FilterOperator, compare_value: Any) -> bool:
        """
        Check if field value matches the filter condition.
        
        Args:
            field_value: The value from the node
            operator: The filter operator
            compare_value: The value to compare against
            
        Returns:
            True if the condition matches, False otherwise
        """
        if field_value is None:
            return False
            
        try:
            if operator == FilterOperator.GT:
                return float(field_value) > float(compare_value)
            elif operator == FilterOperator.GTE:
                return float(field_value) >= float(compare_value)
            elif operator == FilterOperator.LT:
                return float(field_value) < float(compare_value)
            elif operator == FilterOperator.LTE:
                return float(field_value) <= float(compare_value)
            elif operator == FilterOperator.NE:
                return field_value != compare_value
            elif operator == FilterOperator.CONTAINS:
                return str(compare_value) in str(field_value)
            elif operator == FilterOperator.IN:
                if isinstance(compare_value, (list, tuple, set)):
                    return field_value in compare_value
                return field_value == compare_value
            elif operator == FilterOperator.STARTS_WITH:
                return str(field_value).startswith(str(compare_value))
            elif operator == FilterOperator.ENDS_WITH:
                return str(field_value).endswith(str(compare_value))
            else:
                logger.warning(f"Unknown filter operator: {operator}")
                return False
        except (ValueError, TypeError) as e:
            logger.debug(f"Error applying filter operator {operator}: {e}")
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
        
        Uses Neo4j vector index (db.index.vector.queryNodes) with filter map 
        for efficient pre-filtering. Applies post-filtering for non-equality operators.
        
        Args:
            query_embedding: The vector embedding to search against
            top_k: Number of results to return (must be positive)
            filters: Optional filters to apply to metadata fields
            index_name: Optional custom vector index name
            
        Returns:
            List of VectorSearchResult containing nodes and similarity scores
            
        Raises:
            ValueError: If query_embedding is empty/invalid or top_k is invalid
            VectorSearchError: If the search operation fails
        """
        # Input validation
        self._validate_embedding(query_embedding)
        
        if not isinstance(top_k, int):
            raise ValueError("top_k must be an integer")
        if top_k <= 0:
            raise ValueError("top_k must be a positive integer")
        if top_k > 10000:
            logger.warning(f"Large top_k value ({top_k}) may impact performance")
            
        idx_name = index_name or self._vector_index_name
        if not idx_name or not isinstance(idx_name, str):
            raise ValueError("index_name must be a non-empty string")
            
        # Build filter map for pre-filtering (equality only)
        filter_map = self._build_filter_map(filters)
        
        # Request more results if we have post-filters to account for filtering
        request_k = top_k
        has_post_filters = (
            filters and 
            isinstance(filters, dict) and 
            filters.get("custom_filters") and 
            any(
                isinstance(f, dict) and f.get("operator") != FilterOperator.EQ 
                for f in filters["custom_filters"]
            )
        )
        
        if has_post_filters:
            # Increase limit to account for post-filtering, but cap at reasonable max
            request_k = min(top_k * 3, 1000)
            logger.debug(f"Requesting {request_k} results for post-filtering to return top {top_k}")
            
        params: Dict[str, Any] = {
            "embedding": query_embedding,
            "top_k": request_k,
            "index_name": idx_name,
            "filter": filter_map if filter_map else None
        }
        
        query = """
            CALL db.index.vector.queryNodes($index_name, $top_k, $embedding, $filter)
            YIELD node, score
            RETURN node, score
        """
        
        results: List[VectorSearchResult] = []
        
        try:
            async with self.driver.session() as session:
                try:
                    result = await session.run(query, params)
                    
                    async for record in result:
                        try:
                            node = record.get("node")
                            score = record.get("score")
                            
                            if node is None:
                                logger.warning("Received record with missing node")
                                continue
                            if score is None:
                                logger.warning("Received record with missing score")
                                continue
                                
                            # Safely convert score to float
                            try:
                                score_float = float(score)
                                if score_float < 0 or score_float > 1:
                                    logger.debug(f"Unexpected score value: {score_float}")
                            except (ValueError, TypeError) as e:
                                logger.warning(f"Invalid score value: {score}, error: {e}")
                                continue
                                
                            # Extract node properties safely
                            node_data: Dict[str, Any]
                            node_id: str
                            
                            if hasattr(node, "items") and callable(getattr(node, "items")):
                                # It's a Neo4j Node object
                                node_data = dict(node)
                                if hasattr(node, "element_id"):
                                    node_id = str(node.element_id)
                                else:
                                    node_id = node_data.get("id", "")
                            elif isinstance(node, dict):
                                node_data = node
                                node_id = node_data.get("id", "")
                            else:
                                logger.warning(f"Unexpected node type: {type(node)}")
                                continue
                                
                            # Validate required fields
                            if not node_id:
                                logger.warning("Node missing id field")
                                
                            results.append(
                                VectorSearchResult(
                                    node=node_data,
                                    score=score_float,
                                    node_id=node_id
                                )
                            )
                            
                        except Exception as e:
                            logger.error(f"Error processing search result record: {e}")
                            continue
                            
                except ClientError as e:
                    error_msg = str(e).lower()
                    if "index does not exist" in error_msg:
                        raise VectorSearchError(
                            f"Vector index '{idx_name}' does not exist. "
                            "Please create the index first."
                        ) from e
                    elif "embedding dimension" in error_msg:
                        raise VectorSearchError(
                            f"Embedding dimension mismatch: {e}"
                        ) from e
                    raise VectorSearchError(f"Neo4j client error during search: {e}") from e
                except DatabaseError as e:
                    raise VectorSearchError(f"Database error during vector search: {e}") from e
                except Neo4jError as e:
                    raise VectorSearchError(f"Neo4j error: {e}") from e
                except Exception as e:
                    raise VectorSearchError(f"Unexpected error during query execution: {e}") from e
                    
        except ServiceUnavailable as e:
            raise VectorSearchError(f"Neo4j service unavailable: {e}") from e
        except Exception as e:
            if isinstance(e, VectorSearchError):
                raise
            raise VectorSearchError(f"Vector search failed: {e}") from e
            
        # Apply post-filtering for non-equality operators
        if has_post_filters:
            results = self._apply_post_filters(results, filters)
            
        # Sort by score descending and limit to requested top_k
        try:
            results.sort(key=lambda x: x.score, reverse=True)
        except Exception as e:
            logger.error(f"Error sorting results: {e}")
            # Return unsorted rather than failing
            
        return results[:top_k]
