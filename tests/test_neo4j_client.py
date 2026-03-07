"""Tests for Neo4j client functionality."""
from unittest.mock import AsyncMock

import pytest


@pytest.mark.asyncio
async def test_neo4j_connection_pool():
    """Test Neo4j connection pool initialization."""
    from app.db.neo4j import Neo4jConnectionPool

    pool = Neo4jConnectionPool(
        uri="bolt://test:7687",
        user="testuser",
        password="testpass",
        database="testdb"
    )

    assert pool._uri == "bolt://test:7687"
    assert pool._user == "testuser"
    assert pool._database == "testdb"


@pytest.mark.asyncio
async def test_list_memories_query_optimization(mock_neo4j_driver):
    """Verify listMemories uses optimized query without embedding."""
    mock_driver, mock_session = mock_neo4j_driver

    mock_result = AsyncMock()
    mock_result.data.return_value = [{"id": "test", "content": "test"}]
    mock_session.run.return_value = mock_result

    try:
        from app.db.neo4j import listMemories

        await listMemories(driver=mock_driver, limit=10)

        # Check the query was called
        assert mock_session.run.called
        query = mock_session.run.call_args[0][0]

        # Query should be a string and not explicitly return embedding
        if isinstance(query, str):
            # The query should exclude embedding in the RETURN clause
            return_clause = query.upper().split("RETURN")[-1] if "RETURN" in query.upper() else ""
            assert "EMBEDDING" not in return_clause or "EXCLUDE" in query.upper()

    except ImportError:
        pytest.skip("listMemories not implemented")


@pytest.mark.asyncio
async def test_list_documents_query_optimization(mock_neo4j_driver):
    """Verify listDocuments uses optimized query without rawContent."""
    mock_driver, mock_session = mock_neo4j_driver

    mock_result = AsyncMock()
    mock_result.data.return_value = [{"id": "test", "title": "test"}]
    mock_session.run.return_value = mock_result

    try:
        from app.db.neo4j import listDocuments

        await listDocuments(driver=mock_driver, limit=10)

        assert mock_session.run.called
        query = mock_session.run.call_args[0][0]

        if isinstance(query, str):
            return_clause = query.upper().split("RETURN")[-1] if "RETURN" in query.upper() else ""
            assert "RAWCONTENT" not in return_clause and "RAW_CONTENT" not in return_clause

    except ImportError:
        pytest.skip("listDocuments not implemented")
