from __future__ import annotations

import pytest

try:
    from app.task_manager import Task, TaskManager
except ModuleNotFoundError:
    Task = None
    TaskManager = None

pytestmark = pytest.mark.skipif(
    Task is None or TaskManager is None,
    reason="app.task_manager module is required"
)


class TestTask:
    """Test Task dataclass."""

    def test_task_creation_defaults(self) -> None:
        """Test default values."""
        task = Task(id=1, title="Test")
        assert task.id == 1
        assert task.title == "Test"
        assert not task.completed
        assert task.created_at is not None


class TestTaskManager:
    """Test TaskManager functionality."""

    def setup_method(self) -> None:
        """Create fresh manager for each test."""
        self.manager = TaskManager()

    def test_add_task_increments_id(self) -> None:
        """Verify IDs increment correctly."""
        task1 = self.manager.add_task("First")
        task2 = self.manager.add_task("Second")
        assert task1.id == 1
        assert task2.id == 2

    def test_add_task_returns_task(self) -> None:
        """Verify add_task returns Task instance."""
        task = self.manager.add_task("Test")
        assert isinstance(task, Task)
        assert task.title == "Test"
        assert not task.completed

    def test_complete_task_success(self) -> None:
        """Test completing existing task."""
        task = self.manager.add_task("To complete")
        result = self.manager.complete_task(task.id)
        assert result.completed
        assert result.id == task.id

    def test_complete_task_not_found(self) -> None:
        """Test completing non-existent task raises error."""
        with pytest.raises(ValueError, match="not found"):
            self.manager.complete_task(999)

    def test_get_stats_empty(self) -> None:
        """Test stats with no tasks."""
        stats = self.manager.get_stats()
        assert stats["total"] == 0
        assert stats["completed"] == 0
        assert stats["pending"] == 0

    def test_get_stats_mixed(self) -> None:
        """Test stats with mixed completion status."""
        t1 = self.manager.add_task("Task 1")
        _t2 = self.manager.add_task("Task 2")
        self.manager.complete_task(t1.id)
        stats = self.manager.get_stats()
        assert stats["total"] == 2
        assert stats["completed"] == 1
        assert stats["pending"] == 1
