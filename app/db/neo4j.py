import logging
from neo4j import AsyncGraphDatabase, AsyncDriver
from app.config import settings
from app.db.queries import (
    CONSTRAINTS,
    INDEXES,
    get_vector_index_check_query,
    get_vector_index_create_query,
)

logger = logging.getLogger(__name__)

# Global driver instance
_driver: AsyncDriver | None = None


async def get_neo4j_driver() -> AsyncDriver:
    """Returns the global Neo4j driver instance, initializing if necessary."""
    global _driver
    if _driver is None:
        _driver = AsyncGraphDatabase.driver(
            settings.NEO4J_URI, auth=(settings.NEO4J_USER, settings.NEO4J_PASSWORD)
        )
    return _driver


async def close_neo4j_driver() -> None:
    """Closes the global Neo4j driver instance."""
    global _driver
    if _driver:
        await _driver.close()
        _driver = None


async def init_db() -> None:
    """Initializes the Neo4j database with constraints and indexes."""
    driver = await get_neo4j_driver()
    async with driver.session() as session:
        logger.info("Initializing Neo4j constraints and indexes...")
        for query in CONSTRAINTS + INDEXES:
            try:
                await session.run(query)
            except Exception as e:
                logger.warning(
                    f"Error running constraint/index query: {query}. Error: {e}"
                )

        # Vector indexes (using newer 5.15+ syntax or CALL if older.
        # Using CALL as per BLUEPRINT, but catching error if exists)
        vector_indexes = [
            ("entity_embeddings", "Entity", "embedding"),
            ("memory_embeddings", "Memory", "embedding"),
            ("chunk_embeddings", "Chunk", "embedding"),
        ]

        for name, label, prop in vector_indexes:
            try:
                # First check if it exists
                check_query = get_vector_index_check_query(name)
                result = await session.run(check_query)
                exists = await result.single()
                if not exists:
                    create_query = get_vector_index_create_query(
                        name, label, prop, settings.EMBEDDING_DIMENSION
                    )
                    await session.run(create_query)
                    logger.info(f"Vector index '{name}' created.")
                else:
                    logger.info(f"Vector index '{name}' already exists.")
            except Exception as e:
                logger.warning(f"Error creating vector index '{name}': {e}")
