"""Tests for main FastAPI application."""
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_root_endpoint():
    """Test root endpoint returns welcome message."""
    response = client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert "message" in data
    assert "docs" in data


def test_health_check():
    """Test health check endpoint."""
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"


def test_create_item():
    """Test creating an item."""
    item_data = {
        "name": "Test Item",
        "description": "Test Description",
        "price": 10.5,
        "is_active": True
    }
    response = client.post("/items", json=item_data)
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Test Item"
    assert data["price"] == 10.5
    assert "id" in data


def test_list_items():
    """Test listing items."""
    # Create an item first
    client.post("/items", json={"name": "Item 1", "price": 10.0})

    response = client.get("/items")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) > 0


def test_get_item():
    """Test getting a specific item."""
    # Create an item
    create_response = client.post("/items", json={"name": "Get Test", "price": 5.0})
    item_id = create_response.json()["id"]

    response = client.get(f"/items/{item_id}")
    assert response.status_code == 200
    data = response.json()
    assert data["id"] == item_id
    assert data["name"] == "Get Test"


def test_get_item_not_found():
    """Test getting non-existent item returns 404."""
    response = client.get("/items/99999")
    assert response.status_code == 404


def test_update_item():
    """Test updating an item."""
    # Create an item
    create_response = client.post("/items", json={"name": "Update Test", "price": 5.0})
    item_id = create_response.json()["id"]

    update_data = {"name": "Updated Name", "price": 7.0}
    response = client.put(f"/items/{item_id}", json=update_data)
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Updated Name"
    assert data["price"] == 7.0


def test_delete_item():
    """Test deleting an item."""
    # Create an item
    create_response = client.post("/items", json={"name": "Delete Test", "price": 5.0})
    item_id = create_response.json()["id"]

    response = client.delete(f"/items/{item_id}")
    assert response.status_code == 204

    # Verify it's gone
    get_response = client.get(f"/items/{item_id}")
    assert get_response.status_code == 404


def test_list_items_with_pagination():
    """Test item pagination."""
    # Create multiple items
    for i in range(5):
        client.post("/items", json={"name": f"Item {i}", "price": float(i)})

    response = client.get("/items?skip=0&limit=2")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 2


def test_list_items_active_only():
    """Test filtering active items."""
    # Create active and inactive items
    client.post("/items", json={"name": "Active", "price": 10.0, "is_active": True})
    client.post("/items", json={"name": "Inactive", "price": 10.0, "is_active": False})

    response = client.get("/items?active_only=true")
    assert response.status_code == 200
    data = response.json()
    assert all(item["is_active"] for item in data)
