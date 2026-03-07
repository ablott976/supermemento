"""Service-related Pydantic schemas."""

from __future__ import annotations

from pydantic import BaseModel, Field


class ServiceResponse(BaseModel):
    """Response schema for service operations."""
    
    id: str
    name: str
    status: str
    container_tag: str | None = Field(default=None, alias="containerTag")
    
    class Config:
        populate_by_name = True


class AssignServiceRequest(BaseModel):
    """Request schema for assigning a service to a container or user."""
    
    service_id: str = Field(..., description="Unique identifier of the service to assign")
    container_tag: str | None = Field(default=None, description="Target container tag for the assignment")
    user_id: str | None = Field(default=None, description="Target user identifier for the assignment")
    metadata: dict[str, str] | None = Field(default=None, description="Additional metadata for the assignment")
    
    class Config:
        populate_by_name = True
