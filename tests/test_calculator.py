"""Tests for calculator module."""

import pytest

from app.calculator import Calculator


class TestCalculator:
    """Test cases for Calculator."""

    def setup_method(self):
        """Set up test fixtures."""
        self.calc = Calculator()

    def test_add(self):
        """Test addition."""
        assert self.calc.add(2, 3) == 5
        assert self.calc.add(-1, 1) == 0

    def test_divide(self):
        """Test division."""
        assert self.calc.divide(10, 2) == 5.0
        assert self.calc.divide(5, 2) == 2.5

    def test_divide_by_zero(self):
        """Test division by zero raises error."""
        with pytest.raises(ValueError, match="Cannot divide by zero"):
            self.calc.divide(10, 0)
