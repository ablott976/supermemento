"""Neo4j database driver and connection management."""

from neo4j import AsyncDriver, AsyncGraphDatabase

from app.config import settings

_driver: AsyncDriver | None = None


async def init_db() -> None:
    """Initialize the Neo4j driver."""
    global _driver
    _driver = AsyncGraphDatabase.driver(
        settings.NEO4J_URI,
        auth=(settings.NEO4J_USER, settings.NEO4J_PASSWORD),
    )


async def get_neo4j_driver() -> AsyncDriver:
    """Get the Neo4j driver instance."""
    global _driver
    if _driver is None:
        await init_db()
    if _driver is None:
        raise RuntimeError("Failed to initialize Neo4j driver")
    return _driver


async def close_neo4j_driver() -> None:
    """Close the Neo4j driver."""
    global _driver
    if _driver:
        await _driver.close()
        _driver = None
