"""Core application logic."""

from typing import Any


def process_data(data: Any) -> str:
    """Process input data and return string representation.

    Args:
        data: Input data to process.

    Returns:
        String representation of the data.
    """
    return str(data)


class DataProcessor:
    """Process data with validation."""

    def __init__(self) -> None:
        """Initialize processor."""
        self.processed_count = 0

    def process(self, value: int) -> int:
        """Process an integer value.

        Args:
            value: Integer to process.

        Returns:
            Processed value (doubled).
        """
        self.processed_count += 1
        return value * 2
