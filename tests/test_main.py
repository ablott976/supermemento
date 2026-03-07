"""Tests for main application module."""

import pytest

from app.main import calculate_sum, process_data


class TestProcessData:
    """Test cases for process_data function."""

    def test_process_data_success(self) -> None:
        """Test successful data processing."""
        input_data = {"name": "test", "value": 123}
        result = process_data(input_data)
        assert result == {"name": "TEST", "value": 123}

    def test_process_data_empty_dict_raises_error(self) -> None:
        """Test that empty dict raises ValueError."""
        with pytest.raises(ValueError, match="Data cannot be empty"):
            process_data({})

    def test_process_data_with_strings_only(self) -> None:
        """Test processing dict with only string values."""
        input_data = {"a": "hello", "b": "world"}
        result = process_data(input_data)
        assert result == {"a": "HELLO", "b": "WORLD"}


class TestCalculateSum:
    """Test cases for calculate_sum function."""

    def test_calculate_sum_empty_list(self) -> None:
        """Test sum of empty list is zero."""
        assert calculate_sum([]) == 0

    def test_calculate_sum_positive_numbers(self) -> None:
        """Test sum of positive numbers."""
        assert calculate_sum([1, 2, 3]) == 6

    def test_calculate_sum_mixed_numbers(self) -> None:
        """Test sum with negative numbers."""
        assert calculate_sum([-1, 1]) == 0

    def test_calculate_sum_single_element(self) -> None:
        """Test sum with single element."""
        assert calculate_sum([42]) == 42
