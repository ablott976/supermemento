import json
from datetime import datetime, timezone
from enum import Enum
from typing import Any, ClassVar, Dict, Optional
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field


class ContentType(str, Enum):
    TEXT = "text"
    URL = "url"
    PDF = "pdf"
    IMAGE = "image"
    VIDEO = "video"
    AUDIO = "audio"
    CONVERSATION = "conversation"


class DocumentStatus(str, Enum):
    QUEUED = "queued"
    EXTRACTING = "extracting"
    CHUNKING = "chunking"
    EMBEDDING = "embedding"
    INDEXING = "indexing"
    DONE = "done"
    ERROR = "error"


class DocumentBase(BaseModel):
    title: str
    source_url: Optional[str] = None
    content_type: ContentType
    raw_content: str
    container_tag: str
    metadata: Dict[str, Any] = Field(default_factory=dict)
    status: DocumentStatus = DocumentStatus.QUEUED


class DocumentCreate(DocumentBase):
    pass


class Document(DocumentBase):
    """Neo4j Document node model representing ingested content."""
    
    model_config = ConfigDict(from_attributes=True)
    
    # Node identity
    id: UUID = Field(default_factory=uuid4)
    
    # Temporal tracking
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    
    # Neo4j node definition
    __neo4j_label__: ClassVar[str] = "Document"
    
    def to_neo4j_properties(self) -> dict[str, Any]:
        """Convert model to Neo4j node properties.
        
        Stores metadata as JSON string since Neo4j node properties 
        don't support nested dictionaries directly.
        """
        return {
            "id": str(self.id),
            "title": self.title,
            "source_url": self.source_url,
            "content_type": self.content_type.value,
            "raw_content": self.raw_content,
            "container_tag": self.container_tag,
            "metadata": json.dumps(self.metadata) if self.metadata else "{}",
            "status": self.status.value,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }
    
    @classmethod
    def from_neo4j_node(cls, node: dict[str, Any]) -> "Document":
        """Create Document model from Neo4j node properties.
        
        Args:
            node: Dictionary of properties from Neo4j node
            
        Returns:
            Document instance
        """
        data = dict(node)
        
        # Convert UUID strings back to UUID objects
        if "id" in data and isinstance(data["id"], str):
            data["id"] = UUID(data["id"])
        
        # Parse metadata JSON string back to dict
        if "metadata" in data and isinstance(data["metadata"], str):
            data["metadata"] = json.loads(data["metadata"])
        elif "metadata" not in data:
            data["metadata"] = {}
        
        # Convert enum strings back to enum types
        if "content_type" in data and isinstance(data["content_type"], str):
            data["content_type"] = ContentType(data["content_type"])
        if "status" in data and isinstance(data["status"], str):
            data["status"] = DocumentStatus(data["status"])
        
        return cls(**data)
