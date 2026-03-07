"""Main application module."""

from typing import Any


def process_data(data: dict[str, Any]) -> dict[str, Any]:
    """Process input data and return transformed result.

    Args:
        data: Input dictionary to process.

    Returns:
        Processed dictionary with transformed values.

    Raises:
        ValueError: If data is empty.
    """
    if not data:
        raise ValueError("Data cannot be empty")

    return {k: v.upper() if isinstance(v, str) else v for k, v in data.items()}


def calculate_sum(values: list[int]) -> int:
    """Calculate sum of integer values.

    Args:
        values: List of integers to sum.

    Returns:
        Sum of all values.
    """
    return sum(values)
