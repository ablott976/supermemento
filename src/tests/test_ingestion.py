"""Tests for Ingestion API endpoints including container config, listMemories, and listDocuments."""

from collections.abc import Generator
from typing import Any
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from src.server import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def mock_neo4j_client() -> Generator[dict[str, Any], None, None]:
    """Fixture to mock Neo4j client functions used by the ingestion endpoints.
    
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
# GET /api/ingestion/documents tests (listDocuments endpoint)
# =============================================================================

def test_list_documents_success_default_params(mock_neo4j_client: dict[str, Any]) -> None:
    """Test successful retrieval of documents with default parameters."""
    container_id = "test-container-docs"
    mock_docs = [
        {
            "id": "doc-001",
            "title": "Sample PDF Document",
            "content": "Extracted text content from PDF",
            "source": "pdf",
            "file_path": "/uploads/sample.pdf",
            "container_id": container_id,
            "extraction_status": "completed",
            "created_at": "2024-01-15T10:30:00Z",
            "updated_at": "2024-01-15T10:35:00Z",
            "metadata": {
                "page_count": 5,
                "file_size": 1024000,
                "mime_type": "application/pdf"
            }
        },
        {
            "id": "doc-002",
            "title": "Web Article",
            "content": "Content extracted from URL",
            "source": "url",
            "url": "https://example.com/article",
            "container_id": container_id,
            "extraction_status": "completed",
            "created_at": "2024-01-15T11:00:00Z",
            "updated_at": "2024-01-15T11:05:00Z",
            "metadata": {
                "domain": "example.com",
                "fetch_status": 200
            }
        }
    ]
    mock_neo4j_client["list_documents"].return_value = mock_docs

    response = client.get(f"/api/ingestion/documents?containerId={container_id}")

    assert response.status_code == 200
    result = response.json()
    assert isinstance(result, list)
    assert len(result) == 2

    # Verify first document structure
    assert result[0]["id"] == "doc-001"
    assert result[0]["title"] == "Sample PDF Document"
    assert result[0]["content"] == "Extracted text content from PDF"
    assert result[0]["source"] == "pdf"
    assert result[0]["extraction_status"] == "completed"
    assert "metadata" in result[0]
    assert result[0]["metadata"]["page_count"] == 5

    # Verify second document structure
    assert result[1]["id"] == "doc-002"
    assert result[1]["source"] == "url"
    assert result[1]["url"] == "https://example.com/article"


def test_list_documents_with_pagination(mock_neo4j_client: dict[str, Any]) -> None:
    """Test document listing with pagination parameters."""
    container_id = "test-container-page"
    mock_docs = [
        {
            "id": f"doc-{i:03d}",
            "title": f"Document {i}",
            "content": f"Content {i}",
            "source": "text",
            "container_id": container_id,
            "extraction_status": "completed",
            "created_at": "2024-01-15T12:00:00Z",
            "updated_at": "2024-01-15T12:00:00Z",
            "metadata": {}
        }
        for i in range(5, 10)  # Documents 5-9 (second page)
    ]
    mock_neo4j_client["list_documents"].return_value = mock_docs

    response = client.get(
        f"/api/ingestion/documents?containerId={container_id}&limit=5&offset=5"
    )

    assert response.status_code == 200
    result = response.json()
    assert len(result) == 5
    assert result[0]["id"] == "doc-005"

    # Verify pagination parameters were passed to the client
    mock_neo4j_client["list_documents"].assert_called_once_with(
        container_id=container_id,
        limit=5,
        offset=5,
        source=None
    )


def test_list_documents_empty_result(mock_neo4j_client: dict[str, Any]) -> None:
    """Test document listing when no documents exist."""
    container_id = "empty-container"
    mock_neo4j_client["list_documents"].return_value = []

    response = client.get(f"/api/ingestion/documents?containerId={container_id}")

    assert response.status_code == 200
    result = response.json()
    assert isinstance(result, list)
    assert len(result) == 0


def test_list_documents_with_source_filter(mock_neo4j_client: dict[str, Any]) -> None:
    """Test document listing filtered by source type."""
    container_id = "test-container-filter"
    mock_docs = [
        {
            "id": "doc-pdf-001",
            "title": "PDF Doc",
            "content": "PDF content",
            "source": "pdf",
            "container_id": container_id,
            "extraction_status": "completed",
            "created_at": "2024-01-15T10:00:00Z",
            "updated_at": "2024-01-15T10:00:00Z",
            "metadata": {}
        }
    ]
    mock_neo4j_client["list_documents"].return_value = mock_docs

    response = client.get(
        f"/api/ingestion/documents?containerId={container_id}&source=pdf"
    )

    assert response.status_code == 200
    result = response.json()
    assert len(result) == 1
    assert result[0]["source"] == "pdf"

    mock_neo4j_client["list_documents"].assert_called_once_with(
        container_id=container_id,
        limit=100,
        offset=0,
        source="pdf"
    )


def test_list_documents_pending_extraction(mock_neo4j_client: dict[str, Any]) -> None:
    """Test that documents with pending extraction status are returned correctly."""
    container_id = "test-container-pending"
    mock_docs = [
        {
            "id": "doc-pending-001",
            "title": "Uploading Document",
            "content": "",  # Empty content while pending
            "source": "pdf",
            "file_path": "/uploads/pending.pdf",
            "container_id": container_id,
            "extraction_status": "pending",
            "created_at": "2024-01-15T10:00:00Z",
            "updated_at": "2024-01-15T10:00:00Z",
            "metadata": {
                "upload_progress": 50
            }
        }
    ]
    mock_neo4j_client["list_documents"].return_value = mock_docs

    response = client.get(f"/api/ingestion/documents?containerId={container_id}")

    assert response.status_code == 200
    result = response.json()
    assert result[0]["extraction_status"] == "pending"
    assert result[0]["content"] == ""


def test_list_documents_missing_container_id(mock_neo4j_client: dict[str, Any]) -> None:
    """Test validation error when containerId is missing."""
    response = client.get("/api/ingestion/documents")

    assert response.status_code == 400
    assert "containerId" in response.text.lower() or "container_id" in response.text.lower()


def test_list_documents_database_error(mock_neo4j_client: dict[str, Any]) -> None:
    """Test error handling when database query fails."""
    mock_neo4j_client["list_documents"].side_effect = Exception("Database query failed")

    response = client.get("/api/ingestion/documents?containerId=test-container")

    assert response.status_code == 500
    response_data = response.json()
    assert "error" in response_data or "message" in response_data


def test_list_documents_invalid_limit_type(mock_neo4j_client: dict[str, Any]) -> None:
    """Test validation error when limit parameter is not an integer."""
    response = client.get(
        "/api/ingestion/documents?containerId=test-container&limit=invalid"
    )

    assert response.status_code == 422


# =============================================================================
# GET /api/ingestion/memories tests (listMemories endpoint)
# =============================================================================

def test_list_memories_success_default_params(mock_neo4j_client: dict[str, Any]) -> None:
    """Test successful retrieval of memories with default parameters."""
    container_id = "test-container-memories"
    mock_memories = [
        {"id": "mem-1", "content": "Memory 1", "timestamp": "2024-01-01T00:00:00Z"},
        {"id": "mem-2", "content": "Memory 2", "timestamp": "2024-01-02T00:00:00Z"}
    ]
    mock_neo4j_client["list_memories"].return_value = mock_memories

    response = client.get(f"/api/ingestion/memories?containerId={container_id}")

    assert response.status_code == 200
    result = response.json()
    assert len(result) == 2
    assert result[0]["id"] == "mem-1"
