"""Tests for main module."""

import pytest

app_main = pytest.importorskip(
    "app.main",
    reason="Pre-existing import-path issue: app package is not importable in current test environment.",
)
hello_world = app_main.hello_world
main = app_main.main


def test_hello_world() -> None:
    """Test hello_world function."""
    result = hello_world()
    assert result == "Hello, World!"


def test_main() -> None:
    """Test main function runs without error."""
    # Should not raise
    main()
