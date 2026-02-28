"""Neo4j async driver management."""

from neo4j import AsyncGraphDatabase, AsyncDriver
from app.config import settings

# Module-level driver instance
_driver: AsyncDriver | None = None


async def get_neo4j_driver() -> AsyncDriver:
    """Get or create the Neo4j async driver singleton."""
    global _driver
    if _driver is None:
        _driver = AsyncGraphDatabase.driver(
            settings.NEO4J_URI,
            auth=(settings.NEO4J_USER, settings.NEO4J_PASSWORD),
        )
    return _driver


async def close_neo4j_driver() -> None:
    """Close the Neo4j driver if it exists."""
    global _driver
    if _driver is not None:
        await _driver.close()
        _driver = None


async def init_db() -> None:
    """Initialize the database connection and verify connectivity."""
    driver = await get_neo4j_driver()
    await driver.verify_connectivity()
