"""Data models for task management."""

from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum, auto
from typing import Self

from pydantic import BaseModel, Field, field_validator


class TaskStatus(StrEnum):
    """Enumeration of possible task statuses."""

    PENDING = auto()
    IN_PROGRESS = auto()
    COMPLETED = auto()
    CANCELLED = auto()


class Task(BaseModel):
    """Represents a task in the system."""

    id: int | None = Field(default=None, description="Unique identifier")
    title: str = Field(..., min_length=1, max_length=200, description="Task title")
    description: str = Field(default="", max_length=2000, description="Task description")
    status: TaskStatus = Field(default=TaskStatus.PENDING)
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime | None = Field(default=None)
    tags: list[str] = Field(default_factory=list)

    @field_validator("tags")
    @classmethod
    def validate_tags(cls, v: list[str]) -> list[str]:
        """Ensure tags are lowercase and unique."""
        if not v:
            return v
        return sorted({tag.lower().strip() for tag in v if tag.strip()})

    def mark_completed(self) -> Self:
        """Mark task as completed and return self."""
        self.status = TaskStatus.COMPLETED
        self.updated_at = datetime.now(UTC)
        return self

    def mark_in_progress(self) -> Self:
        """Mark task as in progress and return self."""
        if self.status == TaskStatus.COMPLETED:
            raise ValueError("Cannot mark completed task as in progress")
        self.status = TaskStatus.IN_PROGRESS
        self.updated_at = datetime.now(UTC)
        return self

    model_config = {
        "frozen": False,
        "extra": "forbid",
        "validate_assignment": True,
    }
