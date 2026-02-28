from datetime import datetime, timezone
from enum import Enum
from typing import Any, ClassVar, List, Optional
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.config import settings


class MemoryType(str, Enum):
    FACT = "fact"
    PREFERENCE = "preference"
    EPISODE = "episode"
    DERIVED = "derived"


class MemoryBase(BaseModel):
    content: str
    memory_type: MemoryType
    container_tag: str
    is_latest: bool = True
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    source_doc_id: UUID


class MemoryCreate(MemoryBase):
    embedding: Optional[List[float]] = None
    valid_from: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    valid_to: Optional[datetime] = None
    
    @field_validator("embedding")
    @classmethod
    def validate_embedding_dimension(cls, v: Optional[List[float]]) -> Optional[List[float]]:
        if v is not None and len(v) != settings.EMBEDDING_DIMENSION:
            raise ValueError(f"Embedding must have dimension {settings.EMBEDDING_DIMENSION}")
        return v


class Memory(MemoryBase):
    """Neo4j Memory node model representing extracted knowledge."""
    
    model_config = ConfigDict(from_attributes=True)
    
    # Node identity
    id: UUID = Field(default_factory=uuid4)
    
    # Vector embedding
    embedding: Optional[List[float]] = None
    
    # Temporal validity (for time-travel queries)
    valid_from: datetime
    valid_to: Optional[datetime] = None
    
    # Forgetting tracking
    forgotten_at: Optional[datetime] = None
    
    # Creation timestamp
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    
    # Neo4j node definition
    __neo4j_label__: ClassVar[str] = "Memory"
    
    @field_validator("embedding")
    @classmethod
    def validate_embedding_dimension(cls, v: Optional[List[float]]) -> Optional[List[float]]:
        if v is not None and len(v) != settings.EMBEDDING_DIMENSION:
            raise ValueError(f"Embedding must have dimension {settings.EMBEDDING_DIMENSION}")
        return v
    
    def to_neo4j_properties(self) -> dict[str, Any]:
        """Convert model to Neo4j node properties."""
        return {
            "id": str(self.id),
            "content": self.content,
            "memory_type": self.memory_type.value,
            "container_tag": self.container_tag,
            "is_latest": self.is_latest,
            "confidence": self.confidence,
            "source_doc_id": str(self.source_doc_id),
            "embedding": self.embedding,
            "valid_from": self.valid_from,
            "valid_to": self.valid_to,
            "forgotten_at": self.forgotten_at,
            "created_at": self.created_at,
        }
    
    @classmethod
    def from_neo4j_node(cls, node: dict[str, Any]) -> "Memory":
        """Create Memory model from Neo4j node properties.
        
        Args:
            node: Dictionary of properties from Neo4j node
            
        Returns:
            Memory instance
        """
        data = dict(node)
        
        # Convert UUID strings back to UUID objects
        if "id" in data and isinstance(data["id"], str):
            data["id"] = UUID(data["id"])
        if "source_doc_id" in data and isinstance(data["source_doc_id"], str):
            data["source_doc_id"] = UUID(data["source_doc_id"])
        
        # Convert enum strings back to enum types
        if "memory_type" in data and isinstance(data["memory_type"], str):
            data["memory_type"] = MemoryType(data["memory_type"])
        
        return cls(**data)
