import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_read_health(mock_neo4j_driver):
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["neo4j"] == "connected"
