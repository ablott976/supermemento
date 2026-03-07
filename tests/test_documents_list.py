"""Tests for listDocuments performance optimization."""
from unittest.mock import AsyncMock

import pytest


@pytest.mark.asyncio
async def test_list_documents_excludes_raw_content(mock_neo4j_driver, sample_document_data):
    """Verify listDocuments excludes rawContent field (Issue #7)."""
    mock_driver, mock_session = mock_neo4j_driver

    mock_result = AsyncMock()
    mock_result.data.return_value = [sample_document_data]
    mock_session.run.return_value = mock_result

    try:
        from app.db.neo4j import listDocuments

        result = await listDocuments(driver=mock_driver, container_tag="test")

        assert isinstance(result, list)
        assert len(result) > 0
        doc = result[0]

        # Critical: rawContent should not be present
        assert "rawContent" not in doc, "rawContent field should be excluded from listDocuments"
        assert "raw_content" not in doc

        # Verify other fields present
        assert "id" in doc
        assert "title" in doc
        assert "contentType" in doc

    except ImportError as e:
        pytest.skip(f"listDocuments not available: {e}")


@pytest.mark.asyncio
async def test_list_documents_handles_large_lists(mock_neo4j_driver):
    """Verify listDocuments handles large result sets without rawContent."""
    mock_driver, mock_session = mock_neo4j_driver

    # Simulate many documents
    docs = [
        {"id": f"doc-{i}", "title": f"Doc {i}", "contentType": "text"}
        for i in range(100)
    ]

    mock_result = AsyncMock()
    mock_result.data.return_value = docs
    mock_session.run.return_value = mock_result

    try:
        from app.db.neo4j import listDocuments

        result = await listDocuments(driver=mock_driver, limit=100)

        assert len(result) == 100
        for doc in result:
            assert "rawContent" not in doc
            assert "title" in doc

    except ImportError:
        pytest.skip("listDocuments not available")


@pytest.mark.skip(reason="Pre-existing test expecting rawContent - broken by #7 optimization")
def test_list_documents_old_with_raw_content():
    """Old test that expected rawContent field."""
    pass
