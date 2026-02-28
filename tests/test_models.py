from app.models.entity import Entity
from app.models.document import Document, ContentType, DocumentStatus
from app.models.memory import Memory, MemoryType
from app.models.chunk import Chunk
from app.models.user import User
from uuid import uuid4
from datetime import datetime, timezone


def test_entity_model():
    """Verify Entity model has all properties from BLUEPRINT.md."""
    entity = Entity(
        name="Test Entity",
        entityType="Person",
        observations=["Observation 1"],
        embedding=[0.1] * 3072,
        status="active",
        access_count=5,
    )
    assert entity.name == "Test Entity"
    assert entity.entityType == "Person"
    assert len(entity.observations) == 1
    assert entity.status == "active"
    assert entity.access_count == 5
    assert len(entity.embedding) == 3072
    assert isinstance(entity.created_at, datetime)
    assert isinstance(entity.updated_at, datetime)
    assert isinstance(entity.last_accessed_at, datetime)


def test_document_model():
    """Verify Document model has all properties from BLUEPRINT.md."""
    doc_id = uuid4()
    doc = Document(
        id=doc_id,
        title="Test Doc",
        source_url="https://example.com/doc",
        content_type=ContentType.TEXT,
        raw_content="Some content",
        container_tag="user1",
        metadata={"key": "value"},
        status=DocumentStatus.DONE,
    )
    assert doc.id == doc_id
    assert doc.title == "Test Doc"
    assert doc.source_url == "https://example.com/doc"
    assert doc.content_type == ContentType.TEXT
    assert doc.raw_content == "Some content"
    assert doc.container_tag == "user1"
    assert doc.metadata == {"key": "value"}
    assert doc.status == DocumentStatus.DONE
    assert isinstance(doc.created_at, datetime)
    assert isinstance(doc.updated_at, datetime)


def test_memory_model():
    """Verify Memory model has all properties from BLUEPRINT.md."""
    mem_id = uuid4()
    doc_id = uuid4()
    memory = Memory(
        id=mem_id,
        content="Fact 1",
        memory_type=MemoryType.FACT,
        container_tag="user1",
        is_latest=True,
        confidence=0.95,
        embedding=[0.2] * 3072,
        source_doc_id=doc_id,
        valid_from=datetime.now(timezone.utc),
        valid_to=datetime.now(timezone.utc),
        forgotten_at=None,
    )
    assert memory.id == mem_id
    assert memory.content == "Fact 1"
    assert memory.memory_type == MemoryType.FACT
    assert memory.is_latest is True
    assert memory.confidence == 0.95
    assert len(memory.embedding) == 3072
    assert memory.source_doc_id == doc_id
    assert isinstance(memory.created_at, datetime)
    assert isinstance(memory.valid_from, datetime)
    assert isinstance(memory.valid_to, datetime)


def test_chunk_model():
    """Verify Chunk model has all properties from BLUEPRINT.md."""
    chunk_id = uuid4()
    doc_id = uuid4()
    chunk = Chunk(
        id=chunk_id,
        content="Chunk content",
        token_count=10,
        chunk_index=0,
        container_tag="user1",
        embedding=[0.1] * 3072,
        metadata={"page": 1},
        source_doc_id=doc_id,
    )
    assert chunk.id == chunk_id
    assert chunk.content == "Chunk content"
    assert chunk.token_count == 10
    assert chunk.chunk_index == 0
    assert chunk.container_tag == "user1"
    assert len(chunk.embedding) == 3072
    assert chunk.metadata == {"page": 1}
    assert chunk.source_doc_id == doc_id
    assert isinstance(chunk.created_at, datetime)


def test_user_model():
    """Verify User model has all properties from BLUEPRINT.md."""
    user = User(user_id="user1")
    assert user.user_id == "user1"
    assert isinstance(user.created_at, datetime)
    assert isinstance(user.last_active_at, datetime)

    # In a real app we would update the user, here we just verify it exists
    assert user.last_active_at >= user.created_at


def test_embedding_dimension_validation():
    """Verify that models validate embedding dimension."""
    import pytest
    from pydantic import ValidationError

    # Test Entity with wrong embedding dimension
    with pytest.raises(ValidationError) as excinfo:
        Entity(
            name="Test Entity",
            entityType="Person",
            observations=[],
            embedding=[0.1] * 100,  # Wrong dimension (should be 3072)
        )
    assert "Embedding must have dimension 3072" in str(excinfo.value)

    # Test Chunk with wrong embedding dimension
    from app.models.chunk import Chunk
    from uuid import uuid4

    with pytest.raises(ValidationError) as excinfo:
        Chunk(
            content="test",
            token_count=1,
            chunk_index=0,
            container_tag="tag",
            embedding=[0.1] * 10,  # Wrong dimension
            source_doc_id=uuid4(),
        )
    assert "Embedding must have dimension 3072" in str(excinfo.value)


def test_timestamp_auto_generation():
    """Verify that timestamps are automatically generated on model creation."""
    # Entity
    entity = Entity(name="Test", entityType="Type")
    assert entity.created_at is not None
    assert entity.updated_at is not None
    assert (datetime.now(timezone.utc) - entity.created_at).total_seconds() < 1

    # Document
    from app.models.document import ContentType

    doc = Document(
        title="Doc",
        raw_content="Content",
        content_type=ContentType.TEXT,
        container_tag="tag",
    )
    assert doc.created_at is not None
    assert doc.updated_at is not None

    # Memory
    from app.models.memory import MemoryType

    memory = Memory(
        content="Fact",
        container_tag="tag",
        embedding=[0.0] * 3072,
        source_doc_id=doc.id,
        memory_type=MemoryType.FACT,
        valid_from=datetime.now(timezone.utc),
    )
    assert memory.created_at is not None
