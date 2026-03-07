"""
Tests for Ingestion API endpoints including container config, listMemories, and listDocuments.
"""

import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock
from typing import Generator, Any

# Import the FastAPI app - adjust path as needed for actual project structure
from src.server import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def mock_neo4j_client() -> Generator[dict[str, Any], None, None]:
    """
    Fixture to mock Neo4j client functions used by the ingestion endpoints.
    Automatically applied to all tests in this module.
    """
    with patch("src.db.neo4j_client.set_container_config") as mock_set_config, \
         patch("src.db.neo4j_client.getContainerFilterPrompt") as mock_get_filter, \
         patch("src.db.neo4j_client.list_memories") as mock_list_memories, \
         patch("src.db.neo4j_client.list_documents") as mock_list_docs:
        
        # Setup default return values
        mock_set_config.return_value = None
        mock_get_filter.return_value = None
        mock_list_memories.return_value = []
        mock_list_docs.return_value = []
        
        yield {
            "set_container_config": mock_set_config,
            "getContainerFilterPrompt": mock_get_filter,
            "list_memories": mock_list_memories,
            "list_documents": mock_list_docs,
        }


# =============================================================================
# POST /api/ingestion/container-config tests (existing functionality)
# =============================================================================

def test_post_container_config_success_with_filter(mock_neo4j_client: dict[str, Any]) -> None:
    """Test successful container configuration with filter prompt."""
    container_id = "test-container-123"
    filter_prompt = "Summarize the content focusing on key points."
    
    response = client.post(
        "/api/ingestion/container-config",
        json={"containerId": container_id, "filterPrompt": filter_prompt}
    )
    
    assert response.status_code == 200
    assert response.json() == {"message": "Container configuration set successfully."}
    mock_neo4j_client["set_container_config"].assert_called_once_with(container_id, filter_prompt)


def test_post_container_config_success_without_filter(mock_neo4j_client: dict[str, Any]) -> None:
    """Test successful container configuration without filter prompt."""
    container_id = "test-container-456"
    
    response = client.post(
        "/api/ingestion/container-config",
        json={"containerId": container_id}
    )
    
    assert response.status_code == 200
    assert response.json() == {"message": "Container configuration set successfully."}
    mock_neo4j_client["set_container_config"].assert_called_once_with(container_id, None)


def test_post_container_config_missing_container_id(mock_neo4j_client: dict[str, Any]) -> None:
    """Test validation error when containerId is missing."""
    response = client.post(
        "/api/ingestion/container-config",
        json={"filterPrompt": "Some prompt"}
    )
    
    assert response.status_code == 400
    assert "containerId" in response.text or response.json().get("message") == "containerId is required and must be a string."
    mock_neo4j_client["set_container_config"].assert_not_called()


def test_post_container_config_invalid_container_id_type(mock_neo4j_client: dict[str, Any]) -> None:
    """Test validation error when containerId is not a string."""
    response = client.post(
        "/api/ingestion/container-config",
        json={"containerId": 12345, "filterPrompt": "Some prompt"}
    )
    
    assert response.status_code == 422  # FastAPI validation error for type mismatch


def test_post_container_config_invalid_filter_prompt_type(mock_neo4j_client: dict[str, Any]) -> None:
    """Test validation error when filterPrompt is provided but not a string."""
    response = client.post(
        "/api/ingestion/container-config",
        json={"containerId": "test-container-789", "filterPrompt": 12345}
    )
    
    assert response.status_code == 422


def test_post_container_config_database_error(mock_neo4j_client: dict[str, Any]) -> None:
    """Test error handling when database operation fails."""
    mock_neo4j_client["set_container_config"].side_effect = Exception("Database connection error")
    
    response = client.post(
        "/api/ingestion/container-config",
        json={"containerId": "test-container-error", "filterPrompt": "This will fail"}
    )
    
    assert response.status_code == 500
    assert "error" in response.json() or "message" in response.json()


# =============================================================================
# GET /api/ingestion/memories tests (listMemories endpoint)
# =============================================================================

def test_list_memories_success_default_params(mock_neo4j_client: dict[str, Any]) -> None:
    """Test successful retrieval of memories with default pagination."""
    mock_memories = [
        {"id": "mem-001", "content": "First memory content", "containerId": "cont-1", "createdAt": "2024-01-01T00:00:00Z"},
        {"id": "mem-002", "content": "Second memory content", "containerId": "cont-1", "createdAt": "2024-01-02T00:00:00Z"},
    ]
    mock_neo4j_client["list_memories"].return_value = mock_memories
    
    response = client.get("/api/ingestion/memories")
    
    assert response.status_code == 200
    assert response.json() == mock_memories
    mock_neo4j_client["list_memories"].assert_called_once_with(container_id=None, limit=100, offset=0)


def test_list_memories_with_container_filter(mock_neo4j_client: dict[str, Any]) -> None:
    """Test listing memories filtered by containerId."""
    container_id = "container-abc-123"
    mock_memories = [
        {"id": "mem-003", "content": "Filtered memory", "containerId": container_id, "createdAt": "2024-01-03T00:00:00Z"}
    ]
    mock_neo4j_client["list_memories"].return_value = mock_memories
    
    response = client.get(f"/api/ingestion/memories?containerId={container_id}")
    
    assert response.status_code == 200
    assert len(response.json()) == 1
    mock_neo4j_client["list_memories"].assert_called_once_with(container_id=container_id, limit=100, offset=0)


def test_list_memories_with_pagination(mock_neo4j_client: dict[str, Any]) -> None:
    """Test listing memories with limit and offset parameters."""
    mock_memories = [{"id": "mem-004", "content": "Paginated content", "containerId": "cont-2", "createdAt": "2024-01-04T00:00:00Z"}]
    mock_neo4j_client["list_memories"].return_value = mock_memories
    
    response = client.get("/api/ingestion/memories?limit=10&offset=20")
    
    assert response.status_code == 200
    mock_neo4j_client["list_memories"].assert_called_once_with(container_id=None, limit=10, offset=20)


def test_list_memories_with_container_and_pagination(mock_neo4j_client: dict[str, Any]) -> None:
    """Test listing memories with both container filter and pagination."""
    container_id = "cont-special"
    
    response = client.get(f"/api/ingestion/memories?containerId={container_id}&limit=5&offset=10")
    
    assert response.status_code == 200
    mock_neo4j_client["list_memories"].assert_called_once_with(container_id=container_id, limit=5, offset=10)


def test_list_memories_empty_result(mock_neo4j_client: dict[str, Any]) -> None:
    """Test handling of empty memory list."""
    mock_neo4j_client["list_memories"].return_value = []
    
    response = client.get("/api/ingestion/memories")
    
    assert response.status_code == 200
    assert response.json() == []


def test_list_memories_database_error(mock_neo4j_client: dict[str, Any]) -> None:
    """Test error handling when listMemories database operation fails."""
    mock_neo4j_client["list_memories"].side_effect = RuntimeError("
