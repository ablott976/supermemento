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

def test_health_endpoint_response_structure(client):
    """Verify health endpoint returns expected JSON structure."""
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, dict)
    assert "status" in data
    assert "neo4j" in data

def test_health_endpoint_calls_verify_connectivity(client, mock_neo4j_driver):
    """Verify that the health check actually calls driver.verify_connectivity()."""
    # Reset mock to count only calls from this specific request
    mock_neo4j_driver.verify_connectivity.reset_mock()
    client.get("/health")
    mock_neo4j_driver.verify_connectivity.assert_called_once()

def test_health_endpoint_content_type(client):
    """Verify health endpoint returns proper JSON content type."""
    response = client.get("/health")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/json"
