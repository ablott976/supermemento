from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.config import settings

NODE_LABEL = "Memory"


class MemoryType(str, Enum):
    FACT = "fact"
    PREFERENCE = "preference"
    EPISODE = "episode"
    DERIVED = "derived"


class MemoryNode(BaseModel):
    """Pydantic representation of the Neo4j :Memory node label.

    Properties mirror the BLUEPRINT.md schema exactly.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID = Field(default_factory=uuid4)
    content: str
    memory_type: MemoryType
    container_tag: str
    is_latest: bool = True
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    embedding: Optional[list[float]] = None
    valid_from: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc)
    )
    valid_to: Optional[datetime] = None
    forgotten_at: Optional[datetime] = None
    source_doc_id: UUID
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc)
    )

    @field_validator("embedding")
    @classmethod
    def validate_embedding_dimension(
        cls, v: Optional[list[float]]
    ) -> Optional[list[float]]:
        if v is not None and len(v) != settings.EMBEDDING_DIMENSION:
            raise ValueError(
                f"Embedding must have dimension {settings.EMBEDDING_DIMENSION}"
            )
        return v

    @classmethod
    def from_neo4j_record(cls, record: dict[str, Any]) -> "MemoryNode":
        """Instantiate from a raw Neo4j node property dict."""
        return cls(**record)

    def to_neo4j_params(self) -> dict[str, Any]:
        """Return a dict of parameters suitable for Neo4j Cypher queries."""
        return {
            "id": str(self.id),
            "content": self.content,
            "memory_type": self.memory_type.value,
            "container_tag": self.container_tag,
            "is_latest": self.is_latest,
            "confidence": self.confidence,
            "embedding": self.embedding,
            "valid_from": self.valid_from.isoformat(),
            "valid_to": self.valid_to.isoformat() if self.valid_to else None,
            "forgotten_at": self.forgotten_at.isoformat() if self.forgotten_at else None,
            "source_doc_id": str(self.source_doc_id),
            "created_at": self.created_at.isoformat(),
        }
