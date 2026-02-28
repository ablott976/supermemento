from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_read_health(mock_neo4j_driver):
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["neo4j"] == "connected"

def test_read_health_error(monkeypatch):
    # Mock get_neo4j_driver to raise an exception
    async def mock_fail():
        raise Exception("Database down")
    monkeypatch.setattr("app.main.get_neo4j_driver", mock_fail)
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["neo4j"] == "disconnected"
    # Verify that the full error message is NOT in the response
    assert "Database down" not in str(data)
