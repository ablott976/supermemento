import logging

from neo4j import AsyncGraphDatabase

from app.config import settings

logger = logging.getLogger(__name__)

# Module-level driver singleton
_driver = None


async def get_neo4j_driver():
    """Get or create the Neo4j async driver singleton."""
    global _driver
    if _driver is None:
        _driver = AsyncGraphDatabase.driver(
            settings.NEO4J_URI,
            auth=(settings.NEO4J_USER, settings.NEO4J_PASSWORD),
        )
    return _driver


async def close_neo4j_driver():
    """Close the Neo4j driver if initialized."""
    global _driver
    if _driver is not None:
        await _driver.close()
        _driver = None


async def init_db():
    """Initialize the database connection and verify connectivity."""
    driver = await get_neo4j_driver()
    await driver.verify_connectivity()
    logger.info("Successfully connected to Neo4j")
