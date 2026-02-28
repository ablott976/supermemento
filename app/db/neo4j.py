import logging
from neo4j import AsyncGraphDatabase, AsyncDriver
from app.config import settings
from app.db.queries import (
    CONSTRAINTS,
    INDEXES,
    get_vector_index_check_query,
    get_vector_index_create_query
)

logger = logging.getLogger(__name__)

# Global driver instance
_driver: AsyncDriver | None = None


async def get_neo4j_driver() -> AsyncDriver:
    """Returns the global Neo4j driver instance with connection pooling, initializing if necessary."""
    global _driver
    if _driver is None:
        logger.info(f"Initializing Neo4j driver with URI: {settings.NEO4J_URI}")
        _driver = AsyncGraphDatabase.driver(
            settings.NEO4J_URI,
            auth=(settings.NEO4J_USER, settings.NEO4J_PASSWORD),
            max_connection_lifetime=30 * 60,  # 30 minutes
            max_connection_pool_size=50,
            connection_acquisition_timeout=2 * 60,  # 2 minutes
        )
    return _driver


async def close_neo4j_driver() -> None:
    """Closes the global Neo4j driver instance."""
    global _driver
    if _driver:
        logger.info("Closing Neo4j driver...")
        await _driver.close()
        _driver = None


async def init_db() -> None:
    """Initializes the Neo4j database with constraints and indexes."""
    driver = await get_neo4j_driver()
    
    # Verify connectivity before proceeding
    try:
        await driver.verify_connectivity()
        logger.info("Neo4j connectivity verified.")
    except Exception as e:
        logger.error(f"Failed to verify Neo4j connectivity: {e}")
        raise

    async with driver.session() as session:
        logger.info("Initializing Neo4j constraints and indexes...")
        
        # Standard constraints
        for query in CONSTRAINTS:
            try:
                await session.run(query)
            except Exception as e:
                logger.warning(f"Error running constraint query: {query}. Error: {e}")

        # Standard indexes
        for query in INDEXES:
            try:
                await session.run(query)
            except Exception as e:
                logger.warning(f"Error running index query: {query}. Error: {e}")

        # Vector indexes
        vector_indexes = [
            ("entity_embeddings", "Entity", "embedding"),
            ("memory_embeddings", "Memory", "embedding"),
            ("chunk_embeddings", "Chunk", "embedding")
        ]

        for name, label, prop in vector_indexes:
            try:
                # First check if it exists
                check_query = get_vector_index_check_query(name)
                result = await session.run(check_query)
                record = await result.single()
                
                if not record:
                    create_query = get_vector_index_create_query(
                        name, label, prop, settings.EMBEDDING_DIMENSION
                    )
                    await session.run(create_query)
                    logger.info(f"Vector index '{name}' created.")
                else:
                    logger.info(f"Vector index '{name}' already exists.")
            except Exception as e:
                # Some Neo4j versions/configurations might throw error on CREATE if already exists 
                # even with check, or SHOW INDEXES might behave differently.
                logger.warning(f"Error creating vector index '{name}': {e}")
