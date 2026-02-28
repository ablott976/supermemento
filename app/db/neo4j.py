import logging
from neo4j import AsyncGraphDatabase, AsyncDriver
from neo4j.exceptions import ClientError
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
    """Returns the global Neo4j driver instance with connection pooling, initializing if necessary."""
    global _driver
    if _driver is None:
        logger.info(f"Initializing Neo4j driver with URI: {settings.NEO4J_URI}")
        _driver = AsyncGraphDatabase.driver(
            settings.NEO4J_URI,
            auth=(settings.NEO4J_USER, settings.NEO4J_PASSWORD),
            max_connection_pool_size=settings.NEO4J_POOL_SIZE,
            max_connection_lifetime=settings.NEO4J_MAX_CONNECTION_LIFETIME,
            connection_acquisition_timeout=settings.NEO4J_CONNECTION_ACQUISITION_TIMEOUT,
        )
    return _driver


async def close_neo4j_driver() -> None:
    """Closes the global Neo4j driver instance."""
    global _driver
    if _driver:
        logger.info("Closing Neo4j driver...")
        await _driver.close()
        _driver = None


def _is_already_exists_error(error: ClientError) -> bool:
    """Check if a Neo4j ClientError indicates that a constraint or index already exists."""
    already_exists_codes = {
        "Neo.ClientError.Schema.ConstraintAlreadyExists",
        "Neo.ClientError.Schema.IndexAlreadyExists",
        "Neo.ClientError.Schema.EquivalentSchemaObjectAlreadyExists",
    }
    return error.code in already_exists_codes


async def init_db() -> None:
    """Initializes the Neo4j database with constraints and indexes idempotently."""
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
        
        # Create constraints idempotently (IF NOT EXISTS handles most cases,
        # but we catch AlreadyExists errors for robustness)
        for query in CONSTRAINTS:
            try:
                await session.run(query)
                logger.debug(f"Constraint ensured: {query[:60]}...")
            except ClientError as e:
                if _is_already_exists_error(e):
                    logger.debug("Constraint already exists, skipping.")
                else:
                    logger.error(f"Failed to create constraint: {e}")
                    raise
        
        # Create standard indexes idempotently
        for query in INDEXES:
            try:
                await session.run(query)
                logger.debug(f"Index ensured: {query[:60]}...")
            except ClientError as e:
                if _is_already_exists_error(e):
                    logger.debug("Index already exists, skipping.")
                else:
                    logger.error(f"Failed to create index: {e}")
                    raise
        
        # Create vector indexes idempotently
        # Vector indexes don't support IF NOT EXISTS, so we check first then create,
        # handling race conditions with error catching
        vector_indexes = [
            ("entity_embeddings", "Entity", "embedding"),
            ("memory_embeddings", "Memory", "embedding"),
            ("chunk_embeddings", "Chunk", "embedding"),
        ]
        
        for name, label, prop in vector_indexes:
            try:
                # Check if vector index already exists
                check_query = get_vector_index_check_query(name)
                result = await session.run(check_query)
                existing = await result.single()
                if existing:
                    logger.debug(f"Vector index '{name}' already exists.")
                    continue
                
                # Create vector index
                create_query = get_vector_index_create_query(
                    name, label, prop, settings.EMBEDDING_DIMENSION
                )
                await session.run(create_query)
                logger.info(f"Vector index '{name}' created.")
            except ClientError as e:
                # Handle race conditions or "already exists" errors from the procedure
                if _is_already_exists_error(e) or "already exists" in str(e).lower():
                    logger.debug(f"Vector index '{name}' already exists.")
                else:
                    logger.error(f"Failed to create vector index '{name}': {e}")
                    raise
        
        # Add specific entity name constraint for uniqueness
        entity_name_constraint_query = "CREATE CONSTRAINT entity_name IF NOT EXISTS FOR (e:Entity) REQUIRE e.name IS UNIQUE"
        try:
            await session.run(entity_name_constraint_query)
            logger.debug(f"Constraint ensured: {entity_name_constraint_query[:60]}...")
        except ClientError as e:
            if _is_already_exists_error(e):
                logger.debug("Entity name constraint already exists, skipping.")
            else:
                logger.error(f"Failed to create entity name constraint: {e}")
                raise
        
        logger.info("Neo4j constraints and indexes initialized successfully.")
