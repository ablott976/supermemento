from datetime import datetime, timezone
from typing import List, Optional, Dict, Any
from uuid import UUID, uuid4

from pydantic import BaseModel, Field
from enum import Enum

class ContentType(str, Enum):
    text = "text"
    url = "url"
    pdf = "pdf"
    image = "image"
    video = "video"
    audio = "audio"
    conversation = "conversation"

class DocumentStatus(str, Enum):
    queued = "queued"
    extracting = "extracting"
    chunking = "chunking"
    embedding = "embedding"
    indexing = "indexing"
    done = "done"
    error = "error"

class Entity(BaseModel):
    """
    Represents the :Entity node label in Neo4j.
    """
    name: str = Field(..., description="Unique name of the entity")
    entityType: str = Field(..., description="Type of the entity")
    observations: List[str] = Field(default_factory=list, description="List of observations related to the entity")
    embedding: Optional[List[float]] = Field(None, description="Optional embedding vector for the entity")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), description="Timestamp when the entity was created")
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), description="Timestamp when the entity was last updated")
    last_accessed_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), description="Timestamp when the entity was last accessed")
    access_count: int = Field(default=0, description="Number of times the entity has been accessed")
    status: str = Field(default="active", description="Status of the entity (e.g., active, inactive)")

    # Note: The 'unique' constraint for 'name' is a Neo4j constraint handled at the database level.
    # The embedding dimension (3072d) is also a database-level consideration.

class Document(BaseModel):
    """
    Represents the :Document node label in Neo4j.
    """
    id: UUID = Field(..., description="Unique identifier for the document")
    title: str = Field(..., description="Title of the document")
    source_url: Optional[str] = Field(None, description="URL of the source document, if applicable")
    content_type: ContentType = Field(..., description="Type of the document content")
    raw_content: str = Field(..., description="The raw content of the document")
    container_tag: str = Field(..., description="Tag identifying the container or context of the document")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="JSON metadata associated with the document")
    status: DocumentStatus = Field(default=DocumentStatus.queued, description="Status of the document processing pipeline")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), description="Timestamp when the document was created")
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), description="Timestamp when the document was last updated")

    # Note: The id (uuid) will need to be handled by the application when creating Neo4j nodes.
    # The embedding dimension (3072d) is a database-level consideration for potential future indexing.

class Chunk(BaseModel):
    """
    Represents the :Chunk node label in Neo4j.
    """
    id: UUID = Field(default_factory=uuid4, description="Unique identifier for the chunk")
    content: str = Field(..., description="The actual text content of the chunk")
    token_count: int = Field(..., description="Number of tokens in the chunk")
    chunk_index: int = Field(..., description="Index of the chunk within its source document")
    embedding: List[float] = Field(..., description="Embedding vector for the chunk")
    container_tag: str = Field(..., description="Tag identifying the container or context of the chunk")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="JSON metadata associated with the chunk")
    source_doc_id: UUID = Field(..., description="UUID of the source document this chunk belongs to")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), description="Timestamp when the chunk was created")

    # Note: The embedding dimension (3072d) is a database-level consideration for potential future indexing.

class MemoryType(str, Enum):
    fact = "fact"
    preference = "preference"
    episode = "episode"
    derived = "derived"

class Memory(BaseModel):
    """
    Represents the :Memory node label in Neo4j.
    """
    id: UUID = Field(default_factory=uuid4, description="Unique identifier for the memory")
    content: str = Field(..., description="The atomic content of the memory")
    memory_type: MemoryType = Field(..., description="Type of the memory (fact, preference, episode, derived)")
    container_tag: str = Field(..., description="Tag identifying the container or context of the memory")
    is_latest: bool = Field(default=True, description="Flag indicating if this is the latest version of the memory")
    confidence: float = Field(..., ge=0.0, le=1.0, description="Confidence score of the memory (0.0 to 1.0)")
    embedding: Optional[List[float]] = Field(None, description="Optional embedding vector for the memory")
    valid_from: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), description="Timestamp when the memory becomes valid")
    valid_to: Optional[datetime] = Field(None, description="Optional timestamp when the memory becomes invalid")
    forgotten_at: Optional[datetime] = Field(None, description="Timestamp when the memory was forgotten")
    source_doc_id: UUID = Field(..., description="UUID of the source document this memory was extracted from")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), description="Timestamp when the memory was created")

    # Note: The embedding dimension (3072d) is a database-level consideration for potential future indexing.

class User(BaseModel):
    """
    Represents the :User node label in Neo4j.
    """
    user_id: str = Field(..., description="Unique identifier for the user", unique=True) # Assuming unique constraint will be handled at DB level
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), description="Timestamp when the user was created")
    last_active_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), description="Timestamp when the user was last active")

    # Note: The 'unique' constraint for 'user_id' is a Neo4j constraint handled at the database level.
