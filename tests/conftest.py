import pytest
from unittest.mock import AsyncMock, MagicMock


@pytest.fixture
def mock_neo4j_driver(monkeypatch):
    """Create a mock Neo4j driver for testing.
    
    This fixture patches get_neo4j_driver to return a mock driver that can be
    configured by tests for specific Neo4j interactions. The mock supports:
    - verify_connectivity() - async method
    - close() - async method  
    - session() - returns an async context manager mock
    
    Tests can configure the session mock as needed:
        mock_session = AsyncMock()
        mock_neo4j_driver.session.return_value.__aenter__.return_value = mock_session
    """
    mock_driver = MagicMock()
    mock_driver.verify_connectivity = AsyncMock()
    mock_driver.close = AsyncMock()
    
    # Setup session mock to support async context manager pattern
    # This ensures init_db and other session-using code doesn't crash during startup
    mock_session_context = MagicMock()
    mock_session_context.__aenter__ = AsyncMock(return_value=MagicMock())
    mock_session_context.__aexit__ = AsyncMock(return_value=None)
    mock_driver.session.return_value = mock_session_context
    
    async def mock_get_driver():
        return mock_driver
    
    # Patch the driver getter in all locations where it's imported
    monkeypatch.setattr("app.db.neo4j.get_neo4j_driver", mock_get_driver)
    monkeypatch.setattr("app.api.health.get_neo4j_driver", mock_get_driver)
    
    return mock_driver
