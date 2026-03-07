"""Tests for main application."""

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_read_root() -> None:
    """Test root endpoint."""
    response = client.get("/")
    assert response.status_code == 200
    assert response.json() == {"message": "Hello World"}


def test_read_item() -> None:
    """Test item endpoint without query."""
    response = client.get("/items/42")
    assert response.status_code == 200
    assert response.json() == {"item_id": 42}


def test_read_item_with_query() -> None:
    """Test item endpoint with query parameter."""
    response = client.get("/items/42?q=test")
    assert response.status_code == 200
    assert response.json() == {"item_id": 42, "q": "test"}
