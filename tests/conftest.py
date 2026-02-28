import pytest
import os
from unittest.mock import AsyncMock, MagicMock

# Set environment variable for testing as Settings() is loaded at module level
os.environ["NEO4J_PASSWORD"] = "testpassword"

@pytest.fixture
def mock_neo4j_driver(monkeypatch):
    mock_driver = MagicMock()
    mock_driver.verify_connectivity = AsyncMock()
    mock_driver.close = AsyncMock()
    
    async def mock_get_driver():
        return mock_driver
        
    # monkeypatch.setenv("NEO4J_PASSWORD", "testpassword") # Removed as os.environ is used now
    monkeypatch.setattr("app.db.neo4j.get_neo4j_driver", mock_get_driver)
    monkeypatch.setattr("app.main.get_neo4j_driver", mock_get_driver)
    return mock_driver
