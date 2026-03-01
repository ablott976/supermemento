from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

def test_read_health_success(mock_neo4j_driver):
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["neo4j"] == "connected"

def test_read_health_failure(mock_neo4j_driver):
    # Mock verify_connectivity to raise an exception
    mock_neo4j_driver.verify_connectivity.side_effect = Exception("Sensitive DB details!")
    
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    # Ensure it returns "disconnected" and NOT the sensitive exception message
    assert data["neo4j"] == "disconnected"
    assert "Sensitive DB details!" not in str(data["neo4j"])
