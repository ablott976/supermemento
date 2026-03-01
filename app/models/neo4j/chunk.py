from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.config import settings

NODE_LABEL = "Chunk"


class ChunkNode(BaseModel):
    """Pydantic representation of the Neo4j :Chunk node label.

    Properties mirror the BLUEPRINT.md schema exactly.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID = Field(default_factory=uuid4)
    content: str
    token_count: int
    chunk_index: int
    embedding: list[float]
    container_tag: str
    metadata: dict[str, Any] = Field(default_factory=dict)
    source_doc_id: UUID
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc)
    )

    @field_validator("embedding")
    @classmethod
    def validate_embedding_dimension(cls, v: list[float]) -> list[float]:
        if len(v) != settings.EMBEDDING_DIMENSION:
            raise ValueError(
                f"Embedding must have dimension {settings.EMBEDDING_DIMENSION}"
            )
        return v

    @classmethod
    def from_neo4j_record(cls, record: dict[str, Any]) -> "ChunkNode":
        """Instantiate from a raw Neo4j node property dict."""
        return cls(**record)

    def to_neo4j_params(self) -> dict[str, Any]:
        """Return a dict of parameters suitable for Neo4j Cypher queries."""
        return {
            "id": str(self.id),
            "content": self.content,
            "token_count": self.token_count,
            "chunk_index": self.chunk_index,
            "embedding": self.embedding,
            "container_tag": self.container_tag,
            "metadata": self.metadata,
            "source_doc_id": str(self.source_doc_id),
            "created_at": self.created_at.isoformat(),
        }
