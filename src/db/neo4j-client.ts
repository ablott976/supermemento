import json
import uuid
from datetime import datetime
from typing import Any, Optional, TypedDict, cast

from neo4j import AsyncDriver, AsyncGraphDatabase
from neo4j.graph import Node

from ..config import AppConfig
from ..types.enums import DocumentStatus, MemoryType, RelationType
from ..types.models import (
    Chunk,
    ChunkSearchHit,
    Document,
    Memory,
    MemoryRelation,
    MemorySearchHit,
    Metadata,
    Profile,
)

class DocumentCreateInput(TypedDict):
    title: str
    content_type: str  # Document["contentType"] in TS
    raw_content: str
    container_tag: str
    metadata: Optional[Metadata]
    source_url: Optional[str]
    file_path: Optional[str]

class DocumentUpdateInput(TypedDict, total=False):
    title: str
    raw_content: str
    metadata: Metadata | str
    status: DocumentStatus

class MemoryCreateInput(TypedDict):
    content: str
    memory_type: MemoryType
    container_tag: str
    confidence: float
    embedding: list[float]
    source_doc_id: str
    valid_from: Optional[str]
    valid_to: Optional[str]

class MemoryUpdateInput(TypedDict, total=False):
    content: str
    memory_type: MemoryType
    is_latest: bool
    confidence: float
    valid_from: Optional[str]
    valid_to: Optional[str]
    forgotten_at: Optional[str]

class ChunkCreateInput(TypedDict):
    content: str
    embedding: list[float]
    chunk_index: int
    container_tag: str
    metadata: Optional[Metadata | str]
    source_doc_id: str

class ChunkVectorFilters(TypedDict, total=False):
    """Filters for chunk vector search."""
    container_tag: str
    document_id: str
    metadata: Optional[dict[str, Any]]

class MemoryVectorFilters(TypedDict, total=False):
    """Filters for memory vector search."""
    container_tag: str
    memory_type: Optional[MemoryType]
    is_latest: Optional[bool]
    min_confidence: float

class Neo4jClient:
    """Neo4j data access layer for Documents, Memories, and relations."""

    def __init__(self, config: AppConfig) -> None:
        """Creates a new Neo4j client from runtime config."""
        self.driver: AsyncDriver = AsyncGraphDatabase.driver(
            config.NEO4J_URI, auth=(config.NEO4J_USER, config.NEO4J_PASSWORD)
        )

    async def verify_connectivity(self) -> None:
        """Ensures the database connection is valid."""
        await self.driver.verify_connectivity()

    def get_driver(self) -> AsyncDriver:
        """Returns the underlying driver for low-level operations."""
        return self.driver

    async def close(self) -> None:
        """Closes the Neo4j driver."""
        await self.driver.close()

    async def create_document(self, input: DocumentCreateInput) -> Document:
        """Creates a :Document node."""
        async with self.driver.session() as session:
            now = datetime.now().isoformat()
            doc_id = str(uuid.uuid4())
            metadata = input.get("metadata")
            metadata_str = json.dumps(metadata) if isinstance(metadata, dict) else (metadata or "{}")

            result = await session.run(
                """
                CREATE (d:Document {
                    id: $id,
                    title: $title,
                    contentType: $contentType,
                    rawContent: $rawContent,
                    sourceUrl: $sourceUrl,
                    filePath: $filePath,
                    containerTag: $containerTag,
                    metadata: $metadata,
                    status: $status,
                    createdAt: datetime($createdAt),
                    updatedAt: datetime($updatedAt)
                })
                RETURN d
                """,
                {
                    "id": doc_id,
                    "title": input["title"],
                    "contentType": input["content_type"],
                    "rawContent": input["raw_content"],
                    "sourceUrl": input.get("source_url"),
                    "filePath": input.get("file_path"),
                    "containerTag": input["container_tag"],
                    "metadata": metadata_str,
                    "status": DocumentStatus.QUEUED.value,
                    "createdAt": now,
                    "updatedAt": now,
                }
            )
            record = await result.single()
            if not record:
                raise RuntimeError("Failed to create document")
            return self._map_document(record["d"])

    async def get_document(self, document_id: str) -> Optional[Document]:
        """Returns a document by id."""
        async with self.driver.session() as session:
            result = await session.run(
                "MATCH (d:Document {id: $id}) RETURN d LIMIT 1",
                {"id": document_id}
            )
            record = await result.single()
            if not record:
                return None
            return self._map_document(record["d"])

    async def list_documents(
        self,
        container_tag: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[Document]:
        """Returns a list of documents with optional filtering."""
        async with self.driver.session() as session:
            where_clauses = []
            params: dict[str, Any] = {"limit": limit, "offset": offset}
            
            if container_tag:
                where_clauses.append("d.containerTag = $containerTag")
                params["containerTag"] = container_tag
            
            where_clause = "WHERE " + " AND ".join(where_clauses) if where_clauses else ""
            
            result = await session.run(
                f"""
                MATCH (d:Document)
                {where_clause}
                RETURN d
                ORDER BY d.createdAt DESC
                SKIP $offset
                LIMIT $limit
                """,
                params
            )
            documents = []
            async for record in result:
                documents.append(self._map_document(record["d"]))
            return documents

    async def search_chunks_by_vector(
        self,
        query_embedding: list[float],
        limit: int = 10,
        filters: Optional[ChunkVectorFilters] = None,
    ) -> list[ChunkSearchHit]:
        """
        Search chunks by vector similarity with optional filters.
        
        Args:
            query_embedding: The vector to search against
            limit: Maximum number of results to return
            filters: Optional filters to apply to the search
            
        Returns:
            List of chunk search hits with similarity scores
        """
        async with self.driver.session() as session:
            # Build filter conditions
            where_conditions = []
            params: dict[str, Any] = {
                "queryEmbedding": query_embedding,
                "limit": limit,
            }
            
            if filters:
                if filters.get("container_tag"):
                    where_conditions.append("c.containerTag = $containerTag")
                    params["containerTag"] = filters["container_tag"]
                
                if filters.get("document_id"):
                    where_conditions.append("c.sourceDocId = $documentId")
                    params["documentId"] = filters["document_id"]
                
                metadata_filters = filters.get("metadata")
                if metadata_filters:
                    # For metadata filtering, we check JSON containment
                    # This assumes metadata is stored as a JSON string
                    for key, value in metadata_filters.items():
                        param_key = f"meta_{key}"
                        where_conditions.append(f"c.metadata contains ${param_key}")
                        params[param_key] = f'"{key}
