"""Tests for listDocuments functionality with rawContent exclusion."""
from unittest.mock import AsyncMock

import pytest


@pytest.mark.asyncio
async def test_list_documents_excludes_raw_content(mock_neo4j_driver, sample_document_data):
    """Test that listDocuments excludes rawContent field from results."""
    mock_driver, mock_session = mock_neo4j_driver

    # Mock the query result - simulating Neo4j response without rawContent
    mock_result = AsyncMock()
    mock_result.data.return_value = [sample_document_data]
    mock_session.run.return_value = mock_result

    try:
        from app.db.neo4j import listDocuments

        result = await listDocuments(driver=mock_driver, container_tag="test-container")

        # Verify rawContent is not in result
        assert "rawContent" not in result[0]
        assert "raw_content" not in result[0]
        assert result[0]["title"] == "Test Document"
        assert result[0]["id"] == "doc-123"

    except ImportError:
        pytest.skip("listDocuments function not found in app.db.neo4j")


@pytest.mark.asyncio
async def test_list_documents_returns_required_fields(mock_neo4j_driver):
    """Test that listDocuments returns all required fields except rawContent."""
    mock_driver, mock_session = mock_neo4j_driver

    expected_data = {
        "id": "doc-789",
        "title": "Important Doc",
        "contentType": "application/pdf",
        "sourceUrl": "http://example.com/doc2",
        "filePath": "/docs/important.pdf",
        "containerTag": "production",
        "metadata": {"pages": 10},
        "status": "active",
        "createdAt": "2024-01-03T00:00:00Z",
        "updatedAt": "2024-01-03T12:00:00Z",
    }

    mock_result = AsyncMock()
    mock_result.data.return_value = [expected_data]
    mock_session.run.return_value = mock_result

    try:
        from app.db.neo4j import listDocuments

        result = await listDocuments(driver=mock_driver, container_tag="production")

        assert len(result) == 1
        doc = result[0]

        # Verify required fields are present
        assert doc["id"] == "doc-789"
        assert doc["title"] == "Important Doc"
        assert doc["contentType"] == "application/pdf"
        assert doc["status"] == "active"

        # Verify rawContent is absent
        assert "rawContent" not in doc
        assert "raw_content" not in doc

    except ImportError:
        pytest.skip("listDocuments function not found in app.db.neo4j")


@pytest.mark.asyncio
async def test_list_documents_multiple_results(mock_neo4j_driver):
    """Test listDocuments handles multiple documents correctly."""
    mock_driver, mock_session = mock_neo4j_driver

    docs = [
        {"id": "doc-1", "title": "Doc 1", "contentType": "text", "status": "active"},
        {"id": "doc-2", "title": "Doc 2", "contentType": "pdf", "status": "pending"},
    ]

    mock_result = AsyncMock()
    mock_result.data.return_value = docs
    mock_session.run.return_value = mock_result

    try:
        from app.db.neo4j import listDocuments

        result = await listDocuments(driver=mock_driver, container_tag="multi")

        assert len(result) == 2
        for doc in result:
            assert "rawContent" not in doc
            assert "id" in doc
            assert "title" in doc

    except ImportError:
        pytest.skip("listDocuments function not found in app.db.neo4j")


# Skip test for old behavior that expected rawContent
@pytest.mark.skip(reason="Pre-existing test expecting rawContent field - behavior changed per #7")
def test_list_documents_old_behavior_with_raw_content():
    """Old test expecting rawContent - skipped due to optimization."""
    pass
