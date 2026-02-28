import pytest
from fastapi.testclient import TestClient
from app.main import app

@pytest.fixture
def client(mock_neo4j_driver):
    """Create a TestClient with mocked Neo4j driver.
    The mock_neo4j_driver fixture patches get_neo4j_driver before the app lifespan runs,
    ensuring init_db uses the mock during startup.
    """
    return TestClient(app)

def test_read_health(client):
    """Test health endpoint returns 200 and correct status fields."""
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["neo4j"] == "connected"

def test_health_endpoint_calls_verify_connectivity(client, mock_neo4j_driver):
    """Verify that the health check actually calls driver.verify_connectivity()."""
    client.get("/health")
    mock_neo4j_driver.verify_connectivity.assert_called_once()
