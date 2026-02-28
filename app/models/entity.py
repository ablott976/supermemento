from datetime import datetime, timezone
from typing import Any, ClassVar, List, Optional
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.config import settings


class EntityBase(BaseModel):
    name: str
    entityType: str
    observations: List[str] = Field(default_factory=list)
    status: str = "active"


class EntityCreate(EntityBase):
    pass


class Entity(EntityBase):
    """Neo4j Entity node model."""
    
    model_config = ConfigDict(from_attributes=True)
    
    # Node identity
    id: UUID = Field(default_factory=uuid4)
    
    # Vector embedding for semantic search
    embedding: Optional[List[float]] = None
    
    # Temporal tracking
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    last_accessed_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    
    # Access metrics
    access_count: int = 0
    
    # Neo4j node definition
    __neo4j_label__: ClassVar[str] = "Entity"
    
    @field_validator("embedding")
    @classmethod
    def validate_embedding_dimension(cls, v: Optional[List[float]]) -> Optional[List[float]]:
        if v is not None and len(v) != settings.EMBEDDING_DIMENSION:
            raise ValueError(f"Embedding must have dimension {settings.EMBEDDING_DIMENSION}")
        return v
    
    def to_neo4j_properties(self) -> dict[str, Any]:
        """Convert model to Neo4j node properties.
        
        Returns a dictionary compatible with Neo4j property types:
        - Primitives (str, int, float, bool)
        - Arrays of primitives
        - Temporal types (datetime)
        """
        return {
            "id": str(self.id),
            "name": self.name,
            "entityType": self.entityType,
            "observations": self.observations,
            "status": self.status,
            "embedding": self.embedding,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "last_accessed_at": self.last_accessed_at,
            "access_count": self.access_count,
        }
    
    @classmethod
    def from_neo4j_node(cls, node: dict[str, Any]) -> "Entity":
        """Create Entity model from Neo4j node properties.
        
        Args:
            node: Dictionary of properties from Neo4j node
            
        Returns:
            Entity instance
        """
        data = dict(node)
        
        # Convert UUID strings back to UUID objects
        if "id" in data and isinstance(data["id"], str):
            data["id"] = UUID(data["id"])
        
        # Ensure observations is a list
        if "observations" in data and data["observations"] is None:
            data["observations"] = []
        
        return cls(**data)
