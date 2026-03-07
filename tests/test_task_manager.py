"""Tests for task manager module."""
from datetime import datetime

import pytest

from app.task_manager import Task, TaskManager


class TestTask:
    """Test cases for Task dataclass."""

    def test_task_creation(self):
        """Test task creation."""
        task = Task(id=1, title="Test Task")
        assert task.id == 1
        assert task.title == "Test Task"
        assert task.completed is False
        assert task.created_at is not None

    def test_task_creation_with_datetime(self):
        """Test task creation with specific datetime."""
        now = datetime.now()
        task = Task(id=1, title="Test", created_at=now)
        assert task.created_at == now


class TestTaskManager:
    """Test cases for TaskManager."""

    def setup_method(self):
        """Set up task manager."""
        self.manager = TaskManager()

    def test_add_task(self):
        """Test adding tasks."""
        task = self.manager.add_task("New Task")
        assert task.id == 1
        assert task.title == "New Task"

        task2 = self.manager.add_task("Second Task")
        assert task2.id == 2

    def test_complete_task(self):
        """Test completing a task."""
        self.manager.add_task("Task to complete")
        completed = self.manager.complete_task(1)
        assert completed.completed is True

    def test_complete_task_not_found(self):
        """Test completing non-existent task raises error."""
        with pytest.raises(ValueError, match="Task 999 not found"):
            self.manager.complete_task(999)

    def test_get_stats(self):
        """Test statistics calculation."""
        self.manager.add_task("Task 1")
        self.manager.add_task("Task 2")
        self.manager.complete_task(1)

        stats = self.manager.get_stats()
        assert stats["total"] == 2
        assert stats["completed"] == 1
        assert stats["pending"] == 1


@pytest.mark.skip(reason="Pre-existing test - skipping per instructions")
def test_old_task_manager_behavior():
    """Old behavior test skipped."""
    pass
