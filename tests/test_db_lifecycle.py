import pytest
from unittest.mock import patch, MagicMock
from app.db.neo4j import get_neo4j_driver, close_neo4j_driver

@pytest.mark.asyncio
async def test_driver_lifecycle():
    """Test get_neo4j_driver and close_neo4j_driver lifecycle."""
    # Reset global driver for test
    import app.db.neo4j
    app.db.neo4j._driver = None
    
    with patch("neo4j.AsyncGraphDatabase.driver") as mock_driver_factory:
        mock_driver = MagicMock()
        mock_driver.close = pytest.importorskip("unittest.mock").AsyncMock()
        mock_driver_factory.return_value = mock_driver
        
        # 1. Get driver should initialize it
        driver = await get_neo4j_driver()
        assert driver == mock_driver
        mock_driver_factory.assert_called_once()
        
        # 2. Getting driver again should return the same instance
        driver2 = await get_neo4j_driver()
        assert driver2 == mock_driver
        assert mock_driver_factory.call_count == 1
        
        # 3. Closing driver should call close and reset global
        await close_neo4j_driver()
        mock_driver.close.assert_called_once()
        assert app.db.neo4j._driver is None
