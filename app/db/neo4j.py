import logging
from neo4j import AsyncGraphDatabase, AsyncDriver
from app.config import settings

logger = logging.getLogger(__name__)

# Global driver instance
_driver: AsyncDriver | None = None


async def get_neo4j_driver() -> AsyncDriver:
    """Returns the global Neo4j driver instance, initializing if necessary."""
    global _driver
    if _driver is None:
        _driver = AsyncGraphDatabase.driver(
            settings.NEO4J_URI,
            auth=(settings.NEO4J_USER, settings.NEO4J_PASSWORD)
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
        # Constraints
        constraints = [
            "CREATE CONSTRAINT entity_name IF NOT EXISTS FOR (e:Entity) REQUIRE e.name IS UNIQUE",
            "CREATE CONSTRAINT memory_id IF NOT EXISTS FOR (m:Memory) REQUIRE m.id IS UNIQUE",
            "CREATE CONSTRAINT document_id IF NOT EXISTS FOR (d:Document) REQUIRE d.id IS UNIQUE",
            "CREATE CONSTRAINT chunk_id IF NOT EXISTS FOR (c:Chunk) REQUIRE c.id IS UNIQUE",
            "CREATE CONSTRAINT user_id IF NOT EXISTS FOR (u:User) REQUIRE u.user_id IS UNIQUE"
        ]

        # Indexes
        indexes = [
            "CREATE INDEX memory_container IF NOT EXISTS FOR (m:Memory) ON (m.container_tag)",
            "CREATE INDEX memory_latest IF NOT EXISTS FOR (m:Memory) ON (m.is_latest)",
            "CREATE INDEX memory_type IF NOT EXISTS FOR (m:Memory) ON (m.memory_type)",
            "CREATE INDEX document_status IF NOT EXISTS FOR (d:Document) ON (d.status)"
        ]

        logger.info("Initializing Neo4j constraints and indexes...")
        for query in constraints + indexes:
            try:
                await session.run(query)
            except Exception as e:
                logger.warning(f"Error running constraint/index query: {query}. Error: {e}")

        # Vector indexes (using newer 5.15+ syntax or CALL if older. 
        # Using CALL as per BLUEPRINT, but catching error if exists)
        vector_indexes = [
            ("entity_embeddings", "Entity", "embedding"),
            ("memory_embeddings", "Memory", "embedding"),
            ("chunk_embeddings", "Chunk", "embedding")
        ]

        for name, label, prop in vector_indexes:
            try:
                # First check if it exists
                result = await session.run(f"SHOW INDEXES YIELD name WHERE name = '{name}'")
                exists = await result.single()
                if not exists:
                    query = f"CALL db.index.vector.createNodeIndex('{name}', '{label}', '{prop}', {settings.EMBEDDING_DIMENSION}, 'cosine')"
                    await session.run(query)
                    logger.info(f"Vector index '{name}' created.")
                else:
                    logger.info(f"Vector index '{name}' already exists.")
            except Exception as e:
                logger.warning(f"Error creating vector index '{name}': {e}")
