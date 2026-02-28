import pytest
from unittest.mock import AsyncMock, MagicMock

@pytest.fixture
def mock_neo4j_driver(monkeypatch):
    mock_driver = MagicMock()
    mock_driver.verify_connectivity = AsyncMock()
    mock_driver.close = AsyncMock()
    
    async def mock_get_driver():
        return mock_driver
        
    monkeypatch.setattr("app.db.neo4j.get_neo4j_driver", mock_get_driver)
    monkeypatch.setattr("app.api.health.get_neo4j_driver", mock_get_driver)
    return mock_driver
