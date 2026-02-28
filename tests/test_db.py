import pytest
from unittest.mock import AsyncMock
from app.db.neo4j import init_db
from app.db import queries
from app.config import settings


@pytest.mark.asyncio
async def test_init_db(mock_neo4j_driver):
    """Test that init_db runs without errors using a mocked driver."""
    # Setup mock session and run method
    mock_session = AsyncMock()
    mock_neo4j_driver.session.return_value.__aenter__.return_value = mock_session

    # Mock result for vector index check
    mock_result = AsyncMock()
    mock_result.single.return_value = None  # Index doesn't exist
    mock_session.run.return_value = mock_result

    # We need to handle multiple calls to run
    # 1. Constraints (5 calls)
    # 2. Indexes (4 calls)
    # 3. Vector index checks (3 calls)
    # 4. Vector index creations (3 calls if single returns None)

    await init_db()

    # Check if session.run was called multiple times
    assert mock_session.run.called
    assert mock_session.run.call_count >= 12


@pytest.mark.asyncio
async def test_init_db_skips_existing_indexes(mock_neo4j_driver):
    """Test that init_db skips vector index creation if they already exist."""
    # Setup mock session and run method
    mock_session = AsyncMock()
    mock_neo4j_driver.session.return_value.__aenter__.return_value = mock_session

    # Mock result for vector index check: index EXISTS
    mock_result = AsyncMock()
    mock_result.single.return_value = {"name": "entity_embeddings"}
    mock_session.run.return_value = mock_result

    await init_db()

    # In this case, we expect NO vector index creation calls (db.index.vector.createNodeIndex)
    for call in mock_session.run.call_args_list:
        query = call.args[0]
        assert "db.index.vector.createNodeIndex" not in query


def test_embedding_persistence_queries_target_expected_properties():
    """Embedding Cypher should set and fetch the correct node properties."""
    assert "MATCH (e:Entity {name: $name})" in queries.SET_ENTITY_EMBEDDING
    assert (
        "SET e.embedding = $embedding, e.updated_at = $updated_at"
        in queries.SET_ENTITY_EMBEDDING
    )
    assert "RETURN e.embedding as embedding" in queries.GET_ENTITY_EMBEDDING

    assert "MATCH (m:Memory {id: $id})" in queries.SET_MEMORY_EMBEDDING
    assert "SET m.embedding = $embedding" in queries.SET_MEMORY_EMBEDDING
    assert "RETURN m.embedding as embedding" in queries.GET_MEMORY_EMBEDDING

    assert "MATCH (c:Chunk {id: $id})" in queries.SET_CHUNK_EMBEDDING
    assert "SET c.embedding = $embedding" in queries.SET_CHUNK_EMBEDDING
    assert "RETURN c.embedding as embedding" in queries.GET_CHUNK_EMBEDDING


def test_vector_index_create_query_uses_embedding_dimension_setting():
    """Vector indexes should be created with the configured embedding dimension."""
    query = queries.get_vector_index_create_query(
        "entity_embeddings",
        "Entity",
        "embedding",
        settings.EMBEDDING_DIMENSION,
    )

    assert str(settings.EMBEDDING_DIMENSION) in query
    assert "'cosine'" in query
