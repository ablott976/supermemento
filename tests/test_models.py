from app.models.entity import Entity
from app.models.document import Document, ContentType, DocumentStatus
from app.models.memory import Memory, MemoryType
from app.models.chunk import Chunk
from app.models.user import User
from uuid import uuid4
from datetime import datetime, timezone

def test_entity_model():
    entity = Entity(
        name="Test Entity",
        entityType="Person",
        observations=["Observation 1"]
    )
    assert entity.name == "Test Entity"
    assert entity.entityType == "Person"
    assert len(entity.observations) == 1
    assert entity.status == "active"
    assert isinstance(entity.created_at, datetime)

def test_document_model():
    doc = Document(
        title="Test Doc",
        content_type=ContentType.TEXT,
        raw_content="Some content",
        container_tag="user1",
        status=DocumentStatus.DONE
    )
    assert doc.title == "Test Doc"
    assert doc.content_type == ContentType.TEXT
    assert doc.status == DocumentStatus.DONE

def test_memory_model():
    memory = Memory(
        id=uuid4(),
        content="Fact 1",
        memory_type=MemoryType.FACT,
        container_tag="user1",
        source_doc_id=uuid4(),
        valid_from=datetime.now(timezone.utc)
    )
    assert memory.content == "Fact 1"
    assert memory.memory_type == MemoryType.FACT
    assert memory.is_latest is True

def test_chunk_model():
    chunk = Chunk(
        content="Chunk content",
        token_count=10,
        chunk_index=0,
        container_tag="user1",
        embedding=[0.1] * 3072,
        source_doc_id=uuid4()
    )
    assert chunk.content == "Chunk content"
    assert len(chunk.embedding) == 3072

def test_user_model():
    user = User(user_id="user1")
    assert user.user_id == "user1"
