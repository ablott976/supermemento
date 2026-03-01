from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.config import settings


class ChunkBase(BaseModel):
    content: str
    token_count: int
    chunk_index: int
    container_tag: str
    metadata: Dict[str, Any] = Field(default_factory=dict)
    source_doc_id: UUID


class ChunkCreate(ChunkBase):
    embedding: List[float]

    @field_validator("embedding")
    @classmethod
    def validate_embedding_dimension(cls, v: List[float]) -> List[float]:
        if len(v) != settings.EMBEDDING_DIMENSION:
            raise ValueError(f"Embedding must have dimension {settings.EMBEDDING_DIMENSION}")
        return v


class Chunk(ChunkBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID = Field(default_factory=uuid4)
    embedding: Optional[List[float]] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    @field_validator("embedding")
    @classmethod
    def validate_embedding_dimension(cls, v: Optional[List[float]]) -> Optional[List[float]]:
        if v is not None and len(v) != settings.EMBEDDING_DIMENSION:
            raise ValueError(f"Embedding must have dimension {settings.EMBEDDING_DIMENSION}")
        return v
