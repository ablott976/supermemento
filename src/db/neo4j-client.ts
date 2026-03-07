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


 class Neo4jClient:
     """Neo4j data access layer for Documents, Memories, and relations."""
     
     def __init__(self, config: AppConfig) -> None:
         """Creates a new Neo4j client from runtime config."""
         self.driver: AsyncDriver = AsyncGraphDatabase.driver(
             config.NEO4J_URI,
             auth=(config.NEO4J_USER, config.NEO4J_PASSWORD)
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
             result = await session.run(
                 """
                 MATCH (d:Document)
                 WHERE ($containerTag IS NULL OR d.containerTag = $containerTag)
                 AND ($status IS NULL OR d.status = $status)
                 RETURN d
                 ORDER BY d.createdAt DESC
                 LIMIT $limit
                 """,
                 {
                     "containerTag": container_tag,
                     "status": status.value if status else None,
                     "limit": limit,
                 }
             )
             
             documents: list[Document] = []
             async for record in result:
                 documents.append(self._map_document(record["d"]))
             return documents
     
     async def search_chunks(
         self,
         embedding: list[float],
         k: int,
         filter_dict: dict[str, Any],
         index_name: str = "chunk-embeddings"
     ) -> list[ChunkSearchHit]:
         """
         Performs filtered vector search on chunks by passing filter to queryNodes procedure directly.
         
         Args:
             embedding: The query embedding vector
             k: Number of nearest neighbors to return
             filter_dict: Filter map passed directly to queryNodes procedure (e.g., {"containerTag": "xyz"})
             index_name: Name of the vector index
             
         Returns:
             List of chunk search hits with similarity scores
         """
         async with self.driver.session() as session:
             result = await session.run(
                 """
                 CALL db.index.vector.queryNodes($index_name, $k, $embedding, $filter) 
                 YIELD node, score
                 RETURN node, score
                 """,
                 {
                     "index_name": index_name,
                     "k": k,
                     "embedding": embedding,
                     "filter": filter_dict
                 }
             )
             
             hits: list[ChunkSearchHit] = []
             async for record in result:
                 node = cast(Node, record["node"])
                 score = float(record["score"])
                 chunk = self._map_chunk(node)
                 hits.append(ChunkSearchHit(chunk=chunk, score=score))
             
             return hits
     
     async def search_memories(
         self,
         embedding: list[float],
         k: int,
         filter_dict: dict[str, Any],
         index_name: str = "memory-embeddings"
     ) -> list[MemorySearchHit]:
         """
         Performs filtered vector search on memories by passing filter to queryNodes procedure directly.
         
         Args:
             embedding: The query embedding vector
             k: Number of nearest neighbors to return
             filter_dict: Filter map passed directly to queryNodes procedure
             index_name: Name of the vector index
             
         Returns:
             List of memory search hits with similarity scores
         """
         async with self.driver.session() as session:
             result = await session.run(
                 """
                 CALL db.index.vector.queryNodes($index_name, $k, $embedding, $filter) 
                 YIELD node, score
                 RETURN node, score
                 """,
                 {
                     "index_name": index_name,
                     "k": k,
                     "embedding": embedding,
                     "filter": filter_dict
                 }
             )
             
             hits: list[MemorySearchHit] = []
             async for record in result:
                 node = cast(Node, record["node"])
                 score = float(record["score"])
                 memory = self._map_memory(node)
                 hits.append(MemorySearchHit(memory=memory, score=score))
             
             return hits
     
     def _map_chunk(self, node: Node) -> Chunk:
         """Maps a Neo4j node to a Chunk model."""
         props = dict(node)
         return Chunk(
             id=props.get("id", ""),
             content=props.get("content", ""),
             embedding=props.get("embedding", []),
             chunk_index=props.get("chunkIndex", 0),
             container_tag=props.get("containerTag", ""),
             source_doc_id=props.get("sourceDocId", ""),
             metadata=props.get("metadata", {}),
             created_at=props.get("createdAt", datetime.now().isoformat())
         )
     
     def _map_memory(self, node: Node) -> Memory:
         """Maps a Neo4j node to a Memory model."""
         props = dict(node)
         return Memory(
             id=props.get("id", ""),
             content=props.get("content", ""),
             memory_type=MemoryType(props.get("memoryType", "fact")),
             container_tag=props.get("containerTag", ""),
             confidence=props.get("confidence", 1.0),
             embedding=props.get("embedding", []),
             source_doc_id=props.get("sourceDocId", ""),
             is_latest=props.get("isLatest", True),
             valid_from=props.get("validFrom"),
             valid_to=props.get("validTo"),
             created_at=props.get("createdAt", datetime.now().isoformat()),
             updated_at=props.get("updatedAt", datetime.now().isoformat()),
             forgotten_at=props.get("forgottenAt")
         )
     
     def _map_document(self, node: Node) -> Document:
         """Maps a Neo4j node to a Document model."""
         props = dict(node)
         return Document(
             id=props.get("id", ""),
             title=props.get("title", ""),
             content_type=props.get("contentType", ""),
             raw_content=props.get("rawContent", ""),
             container_tag=props.get("containerTag", ""),
             metadata=props.get("metadata", {}),
             status=DocumentStatus(props.get("status", "queued")),
             source_url=props.get("sourceUrl"),
             file_path=props.get("filePath"),
             created_at=props.get("createdAt", datetime.now().isoformat()),
             updated_at=props.get("updatedAt", datetime.now().isoformat())
         )
