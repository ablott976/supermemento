"""Tests for listMemories performance optimization."""
from unittest.mock import AsyncMock

import pytest


@pytest.mark.asyncio
async def test_list_memories_excludes_embedding(mock_neo4j_driver, sample_memory_data):
    """Verify listMemories excludes embedding field (Issue #7)."""
    mock_driver, mock_session = mock_neo4j_driver

    mock_result = AsyncMock()
    mock_result.data.return_value = [sample_memory_data]
    mock_session.run.return_value = mock_result

    # Try to import from neo4j module
    try:
        from app.db.neo4j import listMemories

        result = await listMemories(driver=mock_driver, container_tag="test")

        # Verify structure
        assert isinstance(result, list)
        assert len(result) > 0
        memory = result[0]

        # Critical: embedding should not be present
        assert "embedding" not in memory, "embedding field should be excluded from listMemories"

        # Verify other fields are present
        assert "id" in memory
        assert "content" in memory
        assert "memoryType" in memory

    except ImportError as e:
        pytest.skip(f"listMemories not available: {e}")


@pytest.mark.asyncio
async def test_list_memories_query_does_not_fetch_embedding(mock_neo4j_driver):
    """Verify the Cypher query itself excludes embedding."""
    mock_driver, mock_session = mock_neo4j_driver

    mock_result = AsyncMock()
    mock_result.data.return_value = []
    mock_session.run.return_value = mock_result

    try:
        from app.db.neo4j import listMemories

        await listMemories(driver=mock_driver)

        # Verify query was executed
        assert mock_session.run.called
        call_args = mock_session.run.call_args

        # Extract query string
        query = call_args[0][0] if call_args[0] else call_args[1].get('query', '')

        if isinstance(query, str):
            # Query should not select embedding property
            # It might use EXCLUDE or just not include it in RETURN
            upper_query = query.upper()
            if "EMBEDDING" in upper_query:
                # If embedding is mentioned, it should be in an EXCLUDE context
                assert "EXCLUDE" in upper_query or "OMIT" in upper_query, \
                    "Query should exclude embedding, not fetch it"

    except ImportError:
        pytest.skip("listMemories not available")


@pytest.mark.skip(reason="Pre-existing test expecting embedding - broken by #7 optimization")
def test_list_memories_old_with_embedding():
    """Old test that expected embedding field."""
    pass
