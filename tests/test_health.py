import logging
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_health_check_success(monkeypatch):
    # Mock get_neo4j_driver to return a successful driver
    class MockDriver:
        async def verify_connectivity(self):
            return True

    async def mock_success():
        return MockDriver()

    monkeypatch.setattr("app.main.get_neo4j_driver", mock_success)

    response = client.get("/health")

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["neo4j"] == "connected"


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


def test_health_check_generic_error_message(monkeypatch):
    # Mock get_neo4j_driver to raise an exception with sensitive info
    sensitive_info = "Connection failed: bolt://user:password@internal-neo4j:7687"

    async def mock_fail():
        raise Exception(sensitive_info)

    monkeypatch.setattr("app.main.get_neo4j_driver", mock_fail)

    response = client.get("/health")

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    # Ensure it's the generic message, not the sensitive info
    assert data["neo4j"] == "disconnected"
    assert sensitive_info not in str(data)
