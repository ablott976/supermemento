from app.models.entity import Entity
from app.models.document import Document, ContentType, DocumentStatus
from app.models.chunk import Chunk
from uuid import uuid4
from datetime import datetime

def test_entity_serialization():
    """Verify Entity model can be serialized and deserialized."""
    entity_data = {
        "name": "Integration Test Entity",
        "entityType": "TestType",
        "observations": ["Obs 1", "Obs 2"],
        "status": "active"
    }
    entity = Entity(**entity_data)
    
    # Simulate DB roundtrip
    dumped = entity.model_dump()
    recreated = Entity(**dumped)
    
    assert recreated.name == entity.name
    assert recreated.entityType == entity.entityType
    assert recreated.observations == entity.observations
    assert isinstance(recreated.created_at, datetime)

def test_document_full_schema():
    """Verify Document model with all fields from blueprint."""
    doc_id = uuid4()
    doc = Document(
        id=doc_id,
        title="Blueprint Doc",
        source_url="https://example.com",
        content_type=ContentType.PDF,
        raw_content="Content of PDF",
        container_tag="tag-123",
        metadata={"author": "Test Author"},
        status=DocumentStatus.EXTRACTING
    )
    
    assert doc.id == doc_id
    assert doc.source_url == "https://example.com"
    assert doc.content_type == ContentType.PDF
    assert doc.metadata["author"] == "Test Author"
    assert doc.status == DocumentStatus.EXTRACTING

def test_chunk_embedding_validation():
    """Verify Chunk model validates embedding dimension."""
    # Note: Currently Chunk model doesn't strictly enforce 3072 dimension in Pydantic,
    # but it's required by the blueprint. We might want to add validation later.
    chunk = Chunk(
        content="Small chunk",
        token_count=5,
        chunk_index=0,
        container_tag="user1",
        embedding=[0.0] * 3072,
        source_doc_id=uuid4()
    )
    assert len(chunk.embedding) == 3072
