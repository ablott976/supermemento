import logging
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_health_check_error_logging(monkeypatch, caplog):
    # Mock get_neo4j_driver to raise an exception
    error_message = "Neo4j connection error"
    async def mock_fail():
        raise Exception(error_message)
    
    monkeypatch.setattr("app.main.get_neo4j_driver", mock_fail)
    
    with caplog.at_level(logging.ERROR):
        response = client.get("/health")
        
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["neo4j"] == "disconnected"
    
    # Verify the error was logged
    assert f"Neo4j connection failed: {error_message}" in caplog.text
