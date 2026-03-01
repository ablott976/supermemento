from datetime import datetime, timezone
from enum import Enum
from typing import Any
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field

NODE_LABEL = "Document"


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


class DocumentNode(BaseModel):
    """Pydantic representation of the Neo4j :Document node label.

    Properties mirror the BLUEPRINT.md schema exactly.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID = Field(default_factory=uuid4)
    title: str
    source_url: str | None = None
    content_type: ContentType
    raw_content: str
    container_tag: str
    metadata: dict[str, Any] = Field(default_factory=dict)
    status: DocumentStatus = DocumentStatus.QUEUED
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc)
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc)
    )

    @classmethod
    def from_neo4j_record(cls, record: dict[str, Any]) -> "DocumentNode":
        """Instantiate from a raw Neo4j node property dict."""
        return cls(**record)

    def to_neo4j_params(self) -> dict[str, Any]:
        """Return a dict of parameters suitable for Neo4j Cypher queries."""
        return {
            "id": str(self.id),
            "title": self.title,
            "source_url": self.source_url,
            "content_type": self.content_type.value,
            "raw_content": self.raw_content,
            "container_tag": self.container_tag,
            "metadata": self.metadata,
            "status": self.status.value,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }
