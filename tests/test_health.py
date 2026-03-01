from unittest.mock import patch

from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_read_health(mock_neo4j_driver):
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["neo4j"] == "connected"

def test_health_no_exception_disclosure():
    """Verify that database exception details are not exposed in health endpoint."""
    with patch("app.main.get_neo4j_driver", side_effect=Exception("Connection failed: secret_password")):
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert data["neo4j"] == "disconnected"
        # Verify error details are not exposed
        assert "secret_password" not in str(data)
        assert "Connection failed" not in str(data)
        assert data["neo4j"] == "disconnected"
