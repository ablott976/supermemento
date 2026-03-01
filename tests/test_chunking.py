import os
os.environ.setdefault("RUNNING_TESTS", "1")
os.environ.setdefault("NEO4J_PASSWORD", "test_neo4j_password_for_pytest")

import pytest
from unittest.mock import AsyncMock, patch
from uuid import uuid4
from datetime import datetime
from app.services.chunking import ChunkingService

@pytest.fixture
def service() -> ChunkingService:
    """Create a chunking service instance."""
    return ChunkingService()

@pytest.mark.asyncio
async def test_chunk_empty_text(service: ChunkingService):
    """Empty text should return empty list."""
    chunks = await service.create_chunks(
        doc_id=uuid4(),
        text="",
        container_tag="user1",
    )
    assert chunks == []

@pytest.mark.asyncio
async def test_chunk_single_chunk(service: ChunkingService):
    """Short text should create single chunk."""
    text = "This is a short text."
    doc_id = uuid4()
    chunks = await service.create_chunks(
        doc_id=doc_id,
        text=text,
        container_tag="user1",
        chunk_size=100,
        overlap=0,
    )
    assert len(chunks) == 1
    assert chunks[0].content == text
    assert chunks[0].chunk_index == 0
    assert chunks[0].source_doc_id == doc_id
    assert chunks[0].container_tag == "user1"
    assert chunks[0].token_count > 0
    assert isinstance(chunks[0].created_at, datetime)

@pytest.mark.asyncio
async def test_chunk_multiple_chunks(service: ChunkingService):
    """Long text should create multiple chunks."""
    text = "Word " * 200  # Will exceed typical chunk size
    doc_id = uuid4()
    chunks = await service.create_chunks(
        doc_id=doc_id,
        text=text,
        container_tag="user1",
        chunk_size=50,
        overlap=0,
    )
    assert len(chunks) > 1
    for i, chunk in enumerate(chunks):
        assert chunk.chunk_index == i
        assert chunk.source_doc_id == doc_id

@pytest.mark.asyncio
async def test_chunk_overlap(service: ChunkingService):
    """Chunks should support overlap between consecutive chunks."""
    text = "Sentence one. Sentence two. Sentence three. Sentence four."
    doc_id = uuid4()
    chunks = await service.create_chunks(
        doc_id=doc_id,
        text=text,
        container_tag="user1",
        chunk_size=20,
        overlap=5,
    )
    if len(chunks) > 1:
        # Check that there's some shared content between chunks
        for i in range(len(chunks) - 1):
            current_words = set(chunks[i].content.split())
            next_words = set(chunks[i + 1].content.split())
            assert len(current_words & next_words) > 0, "Consecutive chunks should share words due to overlap"

@pytest.mark.asyncio
async def test_chunk_token_count(service: ChunkingService):
    """Token count should reflect content size."""
    text = "This is exactly five words."
    doc_id = uuid4()
    chunks = await service.create_chunks(
        doc_id=doc_id,
        text=text,
        container_tag="user1",
        chunk_size=100,
    )
    assert len(chunks) == 1
    # Rough check: token count should be close to word count
    assert 3 <= chunks[0].token_count <= 10

@pytest.mark.asyncio
async def test_chunk_with_embeddings(service: ChunkingService):
    """Service should optionally generate embeddings for chunks."""
    text = "Test content"
    doc_id = uuid4()
    # Mock embedding service
    mock_embedding = [0.1] * 3072
    with patch.object(service, "_embedding_service") as mock_emb:
        mock_emb.embed = AsyncMock(return_value=[mock_embedding])
        chunks = await service.create_chunks(
            doc_id=doc_id,
            text=text,
            container_tag="user1",
            chunk_size=100,
            generate_embeddings=True,
        )
        assert len(chunks) == 1
        assert chunks[0].embedding == mock_embedding

@pytest.mark.asyncio
async def test_chunk_without_embeddings(service: ChunkingService):
    """Chunks should not have embeddings when disabled."""
    text = "Test content"
    doc_id = uuid4()
    chunks = await service.create_chunks(
        doc_id=doc_id,
        text=text,
        container_tag="user1",
        chunk_size=100,
        generate_embeddings=False,
    )
    assert len(chunks) == 1
    assert chunks[0].embedding is None

@pytest.mark.asyncio
async def test_chunk_unicode(service: ChunkingService):
    """Should handle unicode content."""
    text = "Hello 世界 🌍"
    doc_id = uuid4()
    chunks = await service.create_chunks(
        doc_id=doc_id,
        text=text,
        container_tag="user1",
        chunk_size=100,
    )
    assert len(chunks) == 1
    assert "世界" in chunks[0].content
    assert "🌍" in chunks[0].content

@pytest.mark.asyncio
async def test_chunk_metadata(service: ChunkingService):
    """Chunks should include metadata."""
    text = "Paragraph one.\n\nParagraph two."
    doc_id = uuid4()
    chunks = await service.create_chunks(
        doc_id=doc_id,
        text=text,
        container_tag="user1",
        chunk_size=10,
    )
    for chunk in chunks:
        assert chunk.metadata is not None
        assert isinstance(chunk.metadata, dict)

@pytest.mark.asyncio
async def test_chunk_batch_embeddings(service: ChunkingService):
    """Multiple chunks should be embedded in batch."""
    text = "Word " * 100  # Create multiple chunks
    doc_id = uuid4()
    # Create multiple mock embeddings
    num_chunks = 5
    mock_embeddings = [[0.1 * i] * 3072 for i in range(num_chunks)]
    
    with patch.object(service, "_embedding_service") as mock_emb:
        mock_emb.embed = AsyncMock(return_value=mock_embeddings)
        chunks = await service.create_chunks(
            doc_id=doc_id,
            text=text,
            container_tag="user1",
            chunk_size=10,
            overlap=0,
            generate_embeddings=True,
        )
        
        # Verify embeddings were assigned to all chunks
        assert len(chunks) == num_chunks
        for i, chunk in enumerate(chunks):
            assert chunk.embedding is not None
            assert len(chunk.embedding) == 3072
        # Verify embed was called once with all texts
        mock_emb.embed.assert_called_once()

@pytest.mark.asyncio
async def test_chunk_embedding_failure_handling(service: ChunkingService):
    """Should handle embedding service failures gracefully."""
    text = "Test content for failure"
    doc_id = uuid4()
    
    with patch.object(service, "_embedding_service") as mock_emb:
        mock_emb.embed = AsyncMock(side_effect=Exception("Embedding service unavailable"))
        
        # Should propagate the exception for the caller to handle
        with pytest.raises(Exception, match="Embedding service unavailable"):
            await service.create_chunks(
                doc_id=doc_id,
                text=text,
                container_tag="user1",
                chunk_size=100,
                generate_embeddings=True,
            )

@pytest.mark.asyncio
async def test_chunk_word_boundaries(service: ChunkingService):
    """Chunks should not break mid-word when possible."""
    text = "This is a test sentence with many words to split."
    doc_id = uuid4()
    chunks = await service.create_chunks(
        doc_id=doc_id,
        text=text,
        container_tag="user1",
        chunk_size=20,
        overlap=0,
    )
    
    # Verify chunks don't start or end with spaces (indicating clean word boundaries)
    for chunk in chunks:
        content = chunk.content
        if len(content) > 0:
            assert not content.startswith(" "), "Chunk should not start with space"
            assert not content.endswith(" "), "Chunk should not end with space"

@pytest.mark.asyncio
async def test_chunk_id_unique(service: ChunkingService):
    """Each chunk should have a unique ID."""
    text = "Word " * 50
    doc_id = uuid4()
    chunks = await service.create_chunks(
        doc_id=doc_id,
        text=text,
        container_tag="user1",
        chunk_size=10,
        overlap=0,
    )
    
    ids = [chunk.id for chunk in chunks]
    assert len(ids) == len(set(ids)), "All chunk IDs should be unique"

@pytest.mark.asyncio
async def test_chunk_container_tag_isolation(service: ChunkingService):
    """Chunks should preserve container tag for multi-tenant isolation."""
    text = "Sensitive user data"
    doc_id = uuid4()
    chunks = await service.create_chunks(
        doc_id=doc_id,
        text=text,
        container_tag="user_123",
        chunk_size=100,
    )
    
    for chunk in chunks:
        assert chunk.container_tag == "user_123"
