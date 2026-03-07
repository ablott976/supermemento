import pytest
from unittest.mock import MagicMock


@pytest.fixture
def mock_neo4j_driver():
    """Create a mock Neo4j driver with defaults for ingestion tests."""
    return MagicMock()
