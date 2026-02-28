from datetime import datetime, timezone
from typing import List, Optional

from pydantic import BaseModel, Field

class Entity(BaseModel):
    """
    Represents the :Entity node label in Neo4j.
    """
    name: str = Field(..., description="Unique name of the entity")
    entityType: str = Field(..., description="Type of the entity")
    observations: List[str] = Field(default_factory=list, description="List of observations related to the entity")
    embedding: Optional[List[float]] = Field(None, description="Optional embedding vector for the entity")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), description="Timestamp when the entity was created")
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), description="Timestamp when the entity was last updated")
    last_accessed_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), description="Timestamp when the entity was last accessed")
    access_count: int = Field(default=0, description="Number of times the entity has been accessed")
    status: str = Field(default="active", description="Status of the entity (e.g., active, inactive)")

    # Note: The 'unique' constraint for 'name' is a Neo4j constraint handled at the database level.
    # The embedding dimension (3072d) is also a database-level consideration.
