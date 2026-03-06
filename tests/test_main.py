"""Tests for main module."""

from app.main import process_data


def test_process_data() -> None:
    """Test process_data function."""
    assert process_data([1, 2, 3]) == [2, 4, 6]
    assert process_data([]) == []
    assert process_data([-1, 0, 1]) == [-2, 0, 2]


def test_process_data_with_negative() -> None:
    """Test process_data with negative numbers."""
    result = process_data([-5, -10])
    assert result == [-10, -20]
