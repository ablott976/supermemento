from datetime import datetime, timezone
from typing import List, Dict, Any
from uuid import UUID, uuid4
from pydantic import BaseModel, Field, ConfigDict

class ChunkBase(BaseModel):
    content: str
    token_count: int
    chunk_index: int
    container_tag: str
    metadata: Dict[str, Any] = Field(default_factory=dict)
    source_doc_id: UUID

class ChunkCreate(ChunkBase):
    embedding: List[float]

class Chunk(ChunkBase):
    model_config = ConfigDict(from_attributes=True)
    
    id: UUID = Field(default_factory=uuid4)
    embedding: List[float]
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
