import asyncio
from typing import List, Optional

from src.db.neo4j_client import Neo4jClient
from src.services.embedding import EmbeddingService
from src.services.ingestion.batching import (
    MemoryBatchInput,
    batch_create_memories,
    gather_with_limit,
)
from src.services.ingestion.chunker import ChunkPayload, ChunkingService
from src.services.ingestion.extractors import (
    ConversationExtractor,
    TextExtractor,
    UrlExtractor,
)
from src.services.ingestion.extractors.base import Extractor
from src.services.ingestion.memory_extractor import (
    ExtractedMemory,
    MemoryExtractorService,
)
from src.services.relation_classifier import RelationClassifierService
from src.types.enums import ContentType, DocumentStatus
from src.types.models import Document, Metadata


class PipelineInput:
    def __init__(
        self,
        title: str,
        content_type: ContentType,
        raw_content: str,
        container_tag: str,
        metadata: Optional[Metadata] = None,
        source_url: Optional[str] = None,
        file_path: Optional[str] = None,
    ):
        self.title = title
        self.content_type = content_type
        self.raw_content = raw_content
        self.container_tag = container_tag
        self.metadata = metadata
        self.source_url = source_url
        self.file_path = file_path


class IngestionPipeline:
    """End-to-end multimodal ingestion orchestrator with parallel LLM processing."""

    def __init__(
        self,
        neo4j_client: Neo4jClient,
        embedding_service: EmbeddingService,
        relation_classifier_service: RelationClassifierService,
        memory_extractor_service: MemoryExtractorService,
    ):
        self.neo4j_client = neo4j_client
        self.embedding_service = embedding_service
        self.relation_classifier_service = relation_classifier_service
        self.chunking_service = ChunkingService()
        self.memory_extractor_service = memory_extractor_service

    async def ingest(
        self, input_data: PipelineInput
    ) -> dict[str, Document | int]:
        """Creates a document and runs full ingestion."""
        document = await self.neo4j_client.create_document(
            title=input_data.title,
            content_type=input_data.content_type,
            raw_content=input_data.raw_content,
            container_tag=input_data.container_tag,
            metadata=input_data.metadata,
            source_url=input_data.source_url,
            file_path=input_data.file_path,
        )
        result = await self.process_document(document.id)
        return {
            "document": result["document"],
            "chunk_count": result["chunk_count"],
            "memory_count": result["memory_count"],
        }

    async def process_document(
        self, document_id: str
    ) -> dict[str, Document | int]:
        """Runs pipeline stages for an existing document with parallel LLM calls."""
        document = await self.neo4j_client.get_document(document_id)
        if not document:
            raise ValueError(f"Document not found: {document_id}")

        try:
            await self._set_status(document.id, DocumentStatus.EXTRACTING)
            extractor = self._get_extractor(document.content_type)
            extracted_text = await extractor.extract(document)
            document = await self.neo4j_client.update_document(
                document.id,
                raw_content=extracted_text,
                status=DocumentStatus.EXTRACTING,
            )

            await self._set_status(document.id, DocumentStatus.CHUNKING)
            chunks = self.chunking_service.chunk(
                document=document,
                content=extracted_text,
            )

            await self._set_status(document.id, DocumentStatus.EXTRACTING_MEMORIES)
            filter_prompt = await self.neo4j_client.get_container_filter_prompt(
                document.container_tag
            )
            
            # Parallel extraction of memories from chunks with concurrency limit
            extracted_memories = await self._extract_memories_parallel(
                chunks, filter_prompt
            )

            await self._set_status(document.id, DocumentStatus.EMBEDDING)
            # Parallel embedding generation for chunks and memories
            chunk_contents = [chunk.content for chunk in chunks]
            memory_contents = [memory.content for memory in extracted_memories]
            
            chunk_embeddings, memory_embeddings = await asyncio.gather(
                self.embedding_service.generate_embeddings(chunk_contents),
                self.embedding_service.generate_embeddings(memory_contents),
            )

            await self._set_status(document.id, DocumentStatus.INDEXING)
            
            # Batch create chunks
            if chunks:
                await self.neo4j_client.create_chunks(
                    [
                        {
                            "content": chunk.content,
                            "chunk_index": chunk.chunk_index,
                            "container_tag": document.container_tag,
                            "source_doc_id": document.id,
                            "metadata": (
                                chunk.metadata.model_dump_json()
                                if hasattr(chunk.metadata, "model_dump_json")
                                else str(chunk.metadata)
                            ),
                            "embedding": chunk_embeddings[i],
                        }
                        for i, chunk in enumerate(chunks)
                    ]
                )

            # Prepare batch inputs for memory creation
            memory_inputs: List[MemoryBatchInput] = []
            for extracted_memory, embedding in zip(extracted_memories, memory_embeddings):
                if not extracted_memory or not embedding:
                    continue
                memory_inputs.append(
                    MemoryBatchInput(
                        content=extracted_memory.content,
                        memory_type=extracted_memory.memory_type,
                        container_tag=document.container_tag,
                        confidence=extracted_memory.confidence,
                        embedding=embedding,
                        source_doc_id=document.id,
                        valid_from=extracted_memory.valid_from,
                        valid_to=extracted_memory.valid_to,
                    )
                )

            # Batch create memories
            memory_ids: List[str] = []
            if memory_inputs:
                memory_ids = await batch_create_memories(
                    self.neo4j_client, memory_inputs
                )

            await self._set_status(document.id, DocumentStatus.COMPLETED)

            return {
                "document": document,
                "chunk_count": len(chunks),
                "memory_count": len(memory_ids),
            }

        except Exception as e:
            await self._set_status(document.id, DocumentStatus.FAILED)
            raise RuntimeError(f"Pipeline failed for document {document_id}: {e}") from e

    def _get_extractor(self, content_type: ContentType) -> Extractor:
        """Get appropriate extractor for content type."""
        match content_type:
            case ContentType.CONVERSATION:
                return ConversationExtractor()
            case ContentType.URL:
                return UrlExtractor()
            case ContentType.TEXT:
                return TextExtractor()
            case _:
                return TextExtractor()

    async def _set_status(self, document_id: str, status: DocumentStatus) -> None:
        """Update document status."""
        await self.neo4j_client.update_document(document_id, status=status)

    async def _extract_memories_parallel(
        self,
        chunks: List[ChunkPayload],
        filter_prompt: Optional[str],
        max_concurrency: int = 5,
    ) -> List[ExtractedMemory]:
        """Extract memories from chunks in parallel with concurrency limit."""
        async def extract_from_chunk(chunk: ChunkPayload) -> List[ExtractedMemory]:
            return await self.memory_extractor_service.extract_memories(
                chunk.content, filter_prompt
            )

        results = await gather_with_limit(
            chunks, extract_from_chunk, max_concurrency
        )
        
        # Flatten list of lists
        return [memory for sublist in results for memory in sublist]
