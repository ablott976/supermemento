"""Tests for calculator module."""

import pytest

from app.calculator import add, subtract, multiply, divide, DivisionByZeroError


class TestAdd:
    """Tests for add function."""

    def test_add_positive_integers(self) -> None:
        assert add(1, 2) == 3
        assert add(0, 5) == 5
        assert add(100, 200) == 300

    def test_add_negative_integers(self) -> None:
        assert add(-1, -2) == -3
        assert add(-5, 5) == 0
        assert add(-10, 3) == -7

    def test_add_floats(self) -> None:
        assert add(1.5, 2.5) == 4.0
        assert add(-1.5, 1.5) == 0.0
        assert add(0.1, 0.2) == pytest.approx(0.3)

    def test_add_mixed_types(self) -> None:
        assert add(1, 2.5) == 3.5
        assert add(1.5, 2) == 3.5


class TestSubtract:
    """Tests for subtract function."""

    def test_subtract_positive_integers(self) -> None:
        assert subtract(5, 3) == 2
        assert subtract(3, 5) == -2
        assert subtract(10, 10) == 0

    def test_subtract_negative_numbers(self) -> None:
        assert subtract(-3, -5) == 2
        assert subtract(-5, -3) == -2
        assert subtract(0, -5) == 5

    def test_subtract_floats(self) -> None:
        assert subtract(5.5, 3.5) == 2.0
        assert subtract(3.5, 5.5) == -2.0


class TestMultiply:
    """Tests for multiply function."""

    def test_multiply_positive_integers(self) -> None:
        assert multiply(3, 4) == 12
        assert multiply(5, 5) == 25

    def test_multiply_negative_numbers(self) -> None:
        assert multiply(-3, 4) == -12
        assert multiply(3, -4) == -12
        assert multiply(-3, -4) == 12

    def test_multiply_by_zero(self) -> None:
        assert multiply(5, 0) == 0
        assert multiply(0, 5) == 0
        assert multiply(0, 0) == 0

    def test_multiply_floats(self) -> None:
        assert multiply(2.5, 4.0) == 10.0
        assert multiply(-1.5, 2.0) == -3.0


class TestDivide:
    """Tests for divide function."""

    def test_divide_positive_integers(self) -> None:
        assert divide(6, 3) == 2.0
        assert divide(7, 2) == 3.5

    def test_divide_negative_numbers(self) -> None:
        assert divide(-6, 3) == -2.0
        assert divide(6, -3) == -2.0
        assert divide(-6, -3) == 2.0

    def test_divide_by_zero_raises_error(self) -> None:
        with pytest.raises(DivisionByZeroError) as exc_info:
            divide(5, 0)
        assert str(exc_info.value) == "Cannot divide by zero"

        with pytest.raises(DivisionByZeroError):
            divide(0, 0)

    def test_divide_floats(self) -> None:
        assert divide(7.5, 2.5) == 3.0
        assert divide(10.0, 3.0) == pytest.approx(3.333, rel=1e-3)

    def test_divide_zero_by_number(self) -> None:
        assert divide(0, 5) == 0.0
        assert divide(0, -5) == -0.0
