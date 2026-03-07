"""Tests for calculator module."""

import pytest

from app.calculator import Calculator


class TestCalculator:
    """Test cases for Calculator."""

    def setup_method(self) -> None:
        """Set up test fixtures."""
        self.calc = Calculator()

    def test_add(self) -> None:
        """Test addition."""
        assert self.calc.add(2, 3) == 5
        assert self.calc.add(-1, 1) == 0
        assert self.calc.add(0.1, 0.2) == pytest.approx(0.3)

    def test_divide(self) -> None:
        """Test division."""
        assert self.calc.divide(6, 2) == 3
        assert self.calc.divide(5, 2) == 2.5

    def test_divide_by_zero(self) -> None:
        """Test division by zero raises error."""
        with pytest.raises(ValueError, match="Cannot divide by zero"):
            self.calc.divide(5, 0)
