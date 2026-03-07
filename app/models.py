"""Domain models for the application."""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class User(BaseModel):
    """User model."""

    id: int
    name: str
    email: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: Optional[datetime] = None


class CreateUserRequest(BaseModel):
    """Request model for creating a user."""

    name: str = Field(..., min_length=1, max_length=100)
    email: str = Field(
        ..., pattern=r"^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$"
    )
