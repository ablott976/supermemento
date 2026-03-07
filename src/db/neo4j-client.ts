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
        status: Optional[DocumentStatus] = None,
        limit: int = 50
    ) -> list[Document]:
        """Lists documents filtered by container tag and optional status."""
        async with self.driver.session() as session:
            where_clauses = []
            params: dict[str, Any] = {"limit": limit}
            if container_tag:
                where_clauses.append("d.containerTag = $container_tag")
                params["container_tag"] = container_tag
            if status:
                where_clauses.append("d.status = $status")
                params["status"] = status.value
            
            where_str = "WHERE " + " AND ".join(where_clauses) if where_clauses else ""
            
            result = await session.run(
                f"""
                MATCH (d:Document)
                {where_str}
                RETURN d
                ORDER BY d.createdAt DESC
                LIMIT $limit
                """,
                params
            )
            documents = []
            async for record in result:
                documents.append(self._map_document(record["d"]))
            return documents

    async def vector_search_chunks(
        self,
        query_embedding: list[float],
        top_k: int = 10,
        filters: Optional[ChunkVectorFilters] = None
    ) -> list[ChunkSearchHit]:
        """
        Perform vector similarity search on chunks with optional metadata filtering.
        
        Args:
            query_embedding: The vector to search against
            top_k: Maximum number of results
            filters: Optional filters including container_tag, document_id
        """
        async with self.driver.session() as session:
            # Build filter conditions
            filter_conditions = []
            params: dict[str, Any] = {
                "query_embedding": query_embedding,
                "top_k": top_k
            }
            
            if filters:
                if filters.get("container_tag"):
                    filter_conditions.append("node.containerTag = $container_tag")
                    params["container_tag"] = filters["container_tag"]
                
                if filters.get("document_id"):
                    filter_conditions.append("node.sourceDocId = $document_id")
                    params["document_id"] = filters["document_id"]
            
            where_clause = ""
            if filter_conditions:
                where_clause = "WHERE " + " AND ".join(filter_conditions)
            
            result = await session.run(
                f"""
                CALL db.index.vector.queryNodes('chunk_embeddings', $top_k, $query_embedding)
                YIELD node, score
                {where_clause}
                RETURN node AS chunk, score
                ORDER BY score DESC
                """,
                params
            )
            
            hits = []
            async for record in result:
                chunk = self._map_chunk(record["chunk"])
                hits.append(ChunkSearchHit(chunk=chunk, score=record["score"]))
            return hits

    async def vector_search_memories(
        self,
        query_embedding: list[float],
        top_k: int = 10,
        filters: Optional[MemoryVectorFilters] = None
    ) -> list[MemorySearchHit]:
        """
        Perform vector similarity search on memories with optional filtering.
        
        Args:
            query_embedding: The vector to search against
            top_k: Maximum number of results
            filters: Optional filters including container_tag, memory_type, is_latest
        """
        async with self.driver.session() as session:
            filter_conditions = []
            params: dict[str, Any] = {
                "query_embedding": query_embedding,
                "top_k": top_k
            }
            
            if filters:
                if filters.get("container_tag"):
                    filter_conditions.append("node.containerTag = $container_tag")
                    params["container_tag"] = filters["container_tag"]
                
                if filters.get("memory_type"):
                    filter_conditions.append("node.memoryType = $memory_type")
                    params["memory_type"] = filters["memory_type"].value
                
                if filters.get("is_latest") is not None:
                    filter_conditions.append("node.isLatest = $is_latest")
                    params["is_latest"] = filters["is_latest"]
                
                if filters.get("min_confidence"):
                    filter_conditions.append("node.confidence >= $min_confidence")
                    params["min_confidence"] = filters["min_confidence"]
            
            where_clause = ""
            if filter_conditions:
                where_clause = "WHERE " + " AND ".join(filter_conditions)
            
            result = await session.run(
                f"""
                CALL db.index.vector.queryNodes('memory_embeddings', $top_k, $query_embedding)
                YIELD node, score
                {where_clause}
                RETURN node AS memory, score
                ORDER BY score DESC
                """,
                params
            )
            
            hits = []
            async for record in result:
                memory = self._map_memory(record["memory"])
                hits.append(MemorySearchHit(memory=memory, score=record["score"]))
            return hits

    def _map_document(self, node: Node) -> Document:
        """Map a Neo4j node to a Document model."""
        return Document(
            id=node["id"],
            title=node["title"],
            contentType=node["contentType"],
            rawContent=node["rawContent"],
            sourceUrl=node.get("sourceUrl"),
            filePath=node.get("filePath"),
            containerTag=node["containerTag"],
            metadata=json.loads(node["metadata"]) if node.get("metadata") else {},
            status=DocumentStatus(node["status"]),
            createdAt=node["createdAt"].isoformat(),
            updatedAt=node["updatedAt"].isoformat(),
        )

    def _map_chunk(self, node: Node) -> Chunk:
        """Map a Neo4j node to a Chunk model."""
        metadata = node.get("metadata", "{}")
        if isinstance(metadata, str):
            metadata = json.loads(metadata)
        return Chunk(
            id=node["id"],
            content=node["content"],
            chunkIndex=node["chunkIndex"],
            containerTag=node
