import pytest
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock
from src.db.neo4j_client import Neo4jClient
from src.types.models import Memory
from src.types.enums import MemoryType


@pytest.fixture
def mock_neo4j_driver():
    """Create a mock Neo4j driver with
