"""Task management module."""

from dataclasses import dataclass
from datetime import datetime
from typing import Any


@dataclass
class Task:
    """Represents a task item."""

    id: int
    title: str
    completed: bool = False
    created_at: datetime | None = None

    def __post_init__(self) -> None:
        """Set default creation time if not provided."""
        if self.created_at is None:
            self.created_at = datetime.now()


class TaskManager:
    """Manage task collection."""

    def __init__(self) -> None:
        """Initialize empty task list."""
        self._tasks: list[Task] = []
        self._next_id: int = 1

    def add_task(self, title: str) -> Task:
        """Create and add new task.

        Args:
            title: Task description.

        Returns:
            Created task instance.
        """
        task = Task(id=self._next_id, title=title)
        self._tasks.append(task)
        self._next_id += 1
        return task

    def complete_task(self, task_id: int) -> Task:
        """Mark task as completed.

        Args:
            task_id: ID of task to complete.

        Returns:
            Updated task.

        Raises:
            ValueError: If task not found.
        """
        for task in self._tasks:
            if task.id == task_id:
                task.completed = True
                return task

        raise ValueError(f"Task {task_id} not found")

    def get_stats(self) -> dict[str, Any]:
        """Return completion statistics.

        Returns:
            Dictionary with total, completed, and pending counts.
        """
        total = len(self._tasks)
        completed = sum(1 for t in self._tasks if t.completed)

        return {
            "total": total,
            "completed": completed,
            "pending": total - completed,
        }
