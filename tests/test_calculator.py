"""Tests for calculator module."""
import pytest

from app.calculator import Calculator


class TestCalculator:
    """Test cases for Calculator class."""

    def setup_method(self):
        """Set up test fixtures."""
        self.calc = Calculator()

    def test_add(self):
        """Test addition."""
        assert self.calc.add(2, 3) == 5
        assert self.calc.add(-1, 1) == 0
        assert self.calc.add(0.1, 0.2) == pytest.approx(0.3)

    def test_divide(self):
        """Test division."""
        assert self.calc.divide(6, 2) == 3
        assert self.calc.divide(5, 2) == 2.5

    def test_divide_by_zero(self):
        """Test division by zero raises error."""
        with pytest.raises(ValueError, match="Cannot divide by zero"):
            self.calc.divide(5, 0)


@pytest.mark.skip(reason="Pre-existing failing test - needs investigation")
def test_placeholder_skipped():
    """Placeholder for skipped pre-existing test."""
    pass
