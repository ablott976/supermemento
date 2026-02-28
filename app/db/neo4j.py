"""Neo4j async driver management."""
import logging
from neo4j import AsyncGraphDatabase, AsyncDriver
from app.config import settings

logger = logging.getLogger(__name__)

_driver: AsyncDriver | None = None


async def get_neo4j_driver() -> AsyncDriver:
    """Get or create the Neo4j async driver singleton.
    
    Returns:
        AsyncDriver: The Neo4j async driver instance.
    """
    global _driver
    if _driver is None:
        _driver = AsyncGraphDatabase.driver(
            settings.NEO4J_URI,
            auth=(settings.NEO4J_USER, settings.NEO4J_PASSWORD),
        )
        logger.debug("Neo4j driver initialized")
    return _driver


async def close_neo4j_driver() -> None:
    """Close the Neo4j driver connection."""
    global _driver
    if _driver is not None:
        await _driver.close()
        _driver = None
        logger.debug("Neo4j driver closed")


async def init_db() -> None:
    """Initialize database and verify connectivity."""
    driver = await get_neo4j_driver()
    await driver.verify_connectivity()
    logger.info("Neo4j database connection established")
