from typing import List
from uuid import UUID

from app.models.chunk import Chunk
from app.services.embedding import EmbeddingService


class ChunkingService:
    """Service to split text into overlapping word-based chunks.

    chunk_size is measured in approximate tokens where 1 token ≈ 2 words.
    overlap is measured in the same token units.
    """

    def __init__(self) -> None:
        self._embedding_service = EmbeddingService()

    async def create_chunks(
        self,
        doc_id: UUID,
        text: str,
        container_tag: str,
        chunk_size: int = 100,
        overlap: int = 0,
        generate_embeddings: bool = False,
    ) -> List[Chunk]:
        """Split *text* into Chunk objects.

        Parameters
        ----------
        doc_id:
            UUID of the parent document.
        text:
            Raw text to chunk.
        container_tag:
            Multi-tenant isolation tag propagated to every chunk.
        chunk_size:
            Approximate number of tokens per chunk (1 token ≈ 2 words).
        overlap:
            Number of tokens to overlap between consecutive chunks.
        generate_embeddings:
            When True, call the embedding service and attach vectors.
        """
        if not text or not text.strip():
            return []

        words = text.split()
        if not words:
            return []

        words_per_chunk = chunk_size * 2
        overlap_words = overlap * 2

        raw_chunks: List[str] = []
        start = 0

        while start < len(words):
            end = min(start + words_per_chunk, len(words))
            raw_chunks.append(" ".join(words[start:end]))
            if end >= len(words):
                break
            step = max(1, words_per_chunk - overlap_words)
            start += step

        chunks: List[Chunk] = []
        for idx, content in enumerate(raw_chunks):
            chunk = Chunk(
                content=content,
                token_count=len(content.split()),
                chunk_index=idx,
                container_tag=container_tag,
                metadata={"chunk_index": idx},
                source_doc_id=doc_id,
            )
            chunks.append(chunk)

        if generate_embeddings:
            texts = [c.content for c in chunks]
            embeddings = await self._embedding_service.embed(texts)
            for chunk, emb in zip(chunks, embeddings):
                chunk.embedding = emb

        return chunks
