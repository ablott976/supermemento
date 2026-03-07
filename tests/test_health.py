"""Tests for health endpoints."""
from unittest.mock import AsyncMock

import pytest


def test_health_check_with_neo4j():
    """Test health check when Neo4j is available."""
    # This test requires the app to be imported with mocked dependencies
    from app.api.health import health_check

    # Mock the driver
    mock_driver = AsyncMock()
    mock_driver.verify_connectivity = AsyncMock()

    # Run the async function
    import asyncio
    result = asyncio.run(health_check(driver=mock_driver))

    assert result["status"] == "ok"
    assert result["neo4j"] == "connected"


def test_health_check_neo4j_failure():
    """Test health check when Neo4j fails."""
    from fastapi import HTTPException

    from app.api.health import health_check

    mock_driver = AsyncMock()
    mock_driver.verify_connectivity = AsyncMock(side_effect=Exception("Connection failed"))

    import asyncio
    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(health_check(driver=mock_driver))

    assert exc_info.value.status_code == 503


@pytest.mark.skip(reason="Pre-existing health test - needs async setup")
def test_health_old():
    """Skipped old health test."""
    pass
