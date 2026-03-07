"""Tests for main module."""


from app.main import hello_world, main


def test_hello_world() -> None:
    """Test hello_world function."""
    result = hello_world()
    assert result == "Hello, World!"


def test_main() -> None:
    """Test main function runs without error."""
    # Should not raise
    main()
