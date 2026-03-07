"""Service schemas."""
from __future__ import annotations

from pydantic import BaseModel, Field


class ServiceResponse(BaseModel):
    """Service definition response."""
    
    id: str
    name: str
    status: str
    container_tag: str | None = None


class AssignServiceRequest(BaseModel):
    """Request to assign a service to a client."""
    
    service_id: str
    container_tag: str | None = None
    user_id: str | None = None
    metadata: dict[str, str] | None = None


class ClientServiceResponse(BaseModel):
    """Client service assignment response."""
    
    service_id: str
    container_tag: str | None = None
    user_id: str | None = None
    status: str
    metadata: dict[str, str] | None = None


class ClientServiceUpdate(BaseModel):
    """Update request for client service assignment."""
    
    container_tag: str | None = None
    user_id: str | None = None
    status: str | None = None
    metadata: dict[str, str] | None = None


class ServiceSearchRequest(BaseModel):
    """Request for filtered vector search on services."""
    
    query: str = Field(..., description="Search query text to vectorize")
    status: str | None = Field(None, description="Filter by service status")
    limit: int = Field(10, ge=1, le=100, description="Maximum number of results")
