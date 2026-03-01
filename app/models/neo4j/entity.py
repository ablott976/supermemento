from datetime import datetime, timezone
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.config import settings

NODE_LABEL = "Entity"


class EntityNode(BaseModel):
    """Pydantic representation of the Neo4j :Entity node label.

    Properties mirror the BLUEPRINT.md schema exactly.
    """

    model_config = ConfigDict(from_attributes=True)

    name: str
    entityType: str
    observations: list[str] = Field(default_factory=list)
    embedding: Optional[list[float]] = None
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc)
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc)
    )
    last_accessed_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc)
    )
    access_count: int = 0
    status: str = "active"

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
    def from_neo4j_record(cls, record: dict[str, Any]) -> "EntityNode":
        """Instantiate from a raw Neo4j node property dict."""
        return cls(**record)

    def to_neo4j_params(self) -> dict[str, Any]:
        """Return a dict of parameters suitable for Neo4j Cypher queries."""
        return {
            "name": self.name,
            "entityType": self.entityType,
            "observations": self.observations,
            "embedding": self.embedding,
            "status": self.status,
            "access_count": self.access_count,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
            "last_accessed_at": self.last_accessed_at.isoformat(),
        }
