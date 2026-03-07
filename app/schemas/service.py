"""Service-related Pydantic schemas."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class ServiceResponse(BaseModel):
    """Standard response schema for service operations."""

    data: Any | None = Field(default=None, description="Response payload.")
    message: str = Field(default="", description="Human-readable response message.")
    status_code: int = Field(description="HTTP-like status code for the response.")


class AssignServiceRequest(BaseModel):
    """Request schema for assigning a service to a container or user."""

    service_id: str = Field(
        ...,
        alias="serviceId",
        description="Unique identifier of the service to assign",
    )
    container_tag: str | None = Field(
        default=None,
        alias="containerTag",
        description="Target container tag for the assignment",
    )
    user_id: str | None = Field(
        default=None,
        alias="userId",
        description="Target user identifier for the assignment",
    )
    metadata: dict[str, str] | None = Field(
        default=None, description="Additional metadata for the assignment"
    )

    class Config:
        populate_by_name = True


class ClientServiceResponse(BaseModel):
    """Response schema for client service assignments."""

    service_id: str = Field(
        ...,
        alias="serviceId",
        description="Identifier of the assigned service",
    )
    container_tag: str | None = Field(
        default=None,
        alias="containerTag",
        description="Container tag bound to this assignment",
    )
    user_id: str | None = Field(
        default=None,
        alias="userId",
        description="User identifier bound to this assignment",
    )
    status: str = Field(description="Current status of the assignment")
    metadata: dict[str, str] | None = Field(
        default=None,
        description="Optional metadata persisted for the assignment",
    )

    class Config:
        populate_by_name = True


class ClientServiceUpdate(BaseModel):
    """Request schema for updating a client service assignment."""

    container_tag: str | None = Field(default=None, alias="containerTag")
    user_id: str | None = Field(default=None, alias="userId")
    status: str | None = None
    metadata: dict[str, str] | None = None

    class Config:
        populate_by_name = True
