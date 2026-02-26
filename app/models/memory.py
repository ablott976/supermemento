from datetime import datetime, timezone
from enum import Enum
from typing import Optional, List
from uuid import UUID, uuid4
from pydantic import BaseModel, Field, ConfigDict, field_validator
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
    model_config = ConfigDict(from_attributes=True)
    
    id: UUID = Field(default_factory=uuid4)
    embedding: Optional[List[float]] = None
    valid_from: datetime
    valid_to: Optional[datetime] = None
    forgotten_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    @field_validator("embedding")
    @classmethod
    def validate_embedding_dimension(cls, v: Optional[List[float]]) -> Optional[List[float]]:
        if v is not None and len(v) != settings.EMBEDDING_DIMENSION:
            raise ValueError(f"Embedding must have dimension {settings.EMBEDDING_DIMENSION}")
        return v
