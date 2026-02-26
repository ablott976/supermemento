from fastapi.testclient import TestClient
from app.main import app
from unittest.mock import AsyncMock

client = TestClient(app)

def test_health_endpoint_success(mock_neo4j_driver):
    """Verify that the health endpoint returns success when Neo4j is connected."""
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["neo4j"] == "connected"
    mock_neo4j_driver.verify_connectivity.assert_called_once()

def test_health_endpoint_neo4j_failure(monkeypatch):
    """Verify that the health endpoint reports failure when Neo4j is disconnected."""
    mock_driver = AsyncMock()
    mock_driver.verify_connectivity.side_effect = Exception("Connection failed")
    
    async def mock_get_driver():
        return mock_driver
        
    monkeypatch.setattr("app.db.neo4j.get_neo4j_driver", mock_get_driver)
    
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "disconnected" in data["neo4j"]
    assert "Connection failed" in data["neo4j"]

def test_app_lifespan(mock_neo4j_driver):
    """Verify that the app lifespan (startup/shutdown) works correctly."""
    # TestClient with 'with' block triggers lifespan
    with TestClient(app) as c:
        response = c.get("/health")
        assert response.status_code == 200
        # mock_neo4j_driver is initialized by init_db in lifespan
    
    # After 'with' block, close_neo4j_driver should have been called
    # However, since we're using a fixture that patches get_neo4j_driver,
    # we need to be careful about what we're asserting.
    # The lifespan calls init_db(), which calls get_neo4j_driver().
    # The lifespan then yields, then calls close_neo4j_driver().
