import json
from datetime import datetime, timezone
from typing import Any, ClassVar, Dict, List
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
    """Neo4j Chunk node model representing text segments for RAG."""

    model_config = ConfigDict(from_attributes=True)

    # Node identity
    id: UUID = Field(default_factory=uuid4)

    # Vector embedding (required for chunks)
    embedding: List[float]

    # Temporal tracking
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    # Neo4j node definition
    __neo4j_label__: ClassVar[str] = "Chunk"

    @field_validator("embedding")
    @classmethod
    def validate_embedding_dimension(cls, v: List[float]) -> List[float]:
        if len(v) != settings.EMBEDDING_DIMENSION:
            raise ValueError(f"Embedding must have dimension {settings.EMBEDDING_DIMENSION}")
        return v

    def to_neo4j_properties(self) -> dict[str, Any]:
        """Convert model to Neo4j node properties.
        
        Stores metadata as JSON string and source_doc_id as string.
        """
        return {
            "id": str(self.id),
            "content": self.content,
            "token_count": self.token_count,
            "chunk_index": self.chunk_index,
            "container_tag": self.container_tag,
            "metadata": json.dumps(self.metadata) if self.metadata else "{}",
            "source_doc_id": str(self.source_doc_id),
            "embedding": self.embedding,
            "created_at": self.created_at,
        }

    @classmethod
    def from_neo4j_node(cls, node: dict[str, Any]) -> "Chunk":
        """Create Chunk model from Neo4j node properties.
        
        Args:
            node: Dictionary of properties from Neo4j node
            
        Returns:
            Chunk instance
        """
        data = dict(node)
        
        # Convert UUID strings back to UUID objects
        if "id" in data and isinstance(data["id"], str):
            data["id"] = UUID(data["id"])
        if "source_doc_id" in data and isinstance(data["source_doc_id"], str):
            data["source_doc_id"] = UUID(data["source_doc_id"])
        
        # Parse metadata JSON string back to dict
        if "metadata" in data and isinstance(data["metadata"], str):
            data["metadata"] = json.loads(data["metadata"])
        elif "metadata" not in data:
            data["metadata"] = {}
        
        return cls(**data)
