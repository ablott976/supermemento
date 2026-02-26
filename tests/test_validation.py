import pytest
from pydantic import ValidationError
from app.models.entity import Entity
from app.models.chunk import Chunk
from app.models.memory import Memory, MemoryType
from uuid import uuid4
from datetime import datetime, timezone

def test_entity_invalid_embedding_dimension():
    """Verify that Entity with wrong embedding dimension fails."""
    with pytest.raises(ValidationError) as excinfo:
        Entity(
            name="Invalid Entity",
            entityType="Person",
            embedding=[0.1, 0.2] # Only 2 dimensions
        )
    assert "Embedding must have dimension" in str(excinfo.value)

def test_chunk_invalid_embedding_dimension():
    """Verify that Chunk with wrong embedding dimension fails."""
    with pytest.raises(ValidationError) as excinfo:
        Chunk(
            content="content",
            token_count=1,
            chunk_index=0,
            container_tag="tag",
            embedding=[0.1],
            source_doc_id=uuid4()
        )
    assert "Embedding must have dimension" in str(excinfo.value)

def test_memory_invalid_embedding_dimension():
    """Verify that Memory with wrong embedding dimension fails."""
    with pytest.raises(ValidationError) as excinfo:
        Memory(
            content="fact",
            memory_type=MemoryType.FACT,
            container_tag="tag",
            embedding=[0.1] * 100,
            source_doc_id=uuid4(),
            valid_from=datetime.now(timezone.utc)
        )
    assert "Embedding must have dimension" in str(excinfo.value)
