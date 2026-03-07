"""Custom exceptions for the task management application."""


class TaskError(Exception):
    """Base exception for task-related errors."""

    def __init__(self, message: str, task_id: int | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.task_id = task_id

    def __str__(self) -> str:
        if self.task_id is not None:
            return f"{self.message} (task_id={self.task_id})"
        return self.message


class TaskNotFoundError(TaskError):
    """Raised when a requested task is not found."""

    def __init__(self, task_id: int) -> None:
        super().__init__("Task not found", task_id)


class TaskValidationError(TaskError):
    """Raised when task validation fails."""

    def __init__(self, message: str, field: str | None = None) -> None:
        super().__init__(message)
        self.field = field


class ProcessingError(Exception):
    """Raised when processing fails."""

    pass


class CalculatorError(Exception):
    """Base exception for calculator errors."""

    pass


class DivisionByZeroError(CalculatorError):
    """Raised when attempting to divide by zero."""

    pass
