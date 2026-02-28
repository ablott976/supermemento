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

# Node Labels
LABEL_ENTITY = "Entity"  # Properties: name, entityType, observations, embedding, created_at, updated_at, last_accessed_at, access_count, status
LABEL_DOCUMENT = "Document"  # Properties: id, title, source_url, content_type, raw_content, container_tag, metadata, status, created_at, updated_at
LABEL_CHUNK = "Chunk"  # Properties: id, content, token_count, chunk_index, embedding, container_tag, metadata, source_doc_id, created_at
LABEL_MEMORY = "Memory"  # Properties: id, content, memory_type, container_tag, is_latest, confidence, embedding, valid_from, valid_to, forgotten_at, source_doc_id, created_at
LABEL_USER = "User"  # Properties: user_id, created_at, last_active_at

# Relationship Types
# These constants represent the Neo4j relationship types used throughout the system.
REL_BELONGS_TO = "BELONGS_TO"
REL_PART_OF = "PART_OF"
REL_EXTRACTED_FROM = "EXTRACTED_FROM"
REL_RELATES_TO = "RELATES_TO"
REL_UPDATES = "UPDATES"
REL_EXTENDS = "EXTENDS"
REL_DERIVES = "DERIVES"

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
    """Initializes the Neo4j database with constraints and indexes idempotently.
    
    This follows the schema defined in docs/BLUEPRINT.md §3:
    - Entity: name (unique), entityType, observations, embedding, status, etc.
    - Document: id (unique), title, raw_content, etc.
    - Chunk: id (unique), content, embedding, etc.
    - Memory: id (unique), content, embedding, is_latest, etc.
    - User: user_id (unique)
    """
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
        
        # 1. Create constraints idempotently (IF NOT EXISTS)
        # Includes Entity name uniqueness as per spec
        constraint_count = 0
        for query in CONSTRAINTS:
            try:
                await session.run(query)
                constraint_count += 1
                logger.debug(f"Constraint ensured: {query[:60]}...")
            except ClientError as e:
                if _is_already_exists_error(e):
                    logger.debug("Constraint already exists, skipping.")
                else:
                    logger.error(f"Failed to create constraint: {e}")
                    raise
        logger.info(f"Ensured {constraint_count} constraints.")
        
        # 2. Create standard indexes idempotently
        index_count = 0
        for query in INDEXES:
            try:
                await session.run(query)
                index_count += 1
                logger.debug(f"Index ensured: {query[:60]}...")
            except ClientError as e:
                if _is_already_exists_error(e):
                    logger.debug("Index already exists, skipping.")
                else:
                    logger.error(f"Failed to create index: {e}")
                    raise
        logger.info(f"Ensured {index_count} standard indexes.")
        
        # 3. Create vector indexes idempotently
        # Vector indexes don't support IF NOT EXISTS, so we check first then create
        vector_indexes = [
            ("entity_embedding", LABEL_ENTITY, "embedding", settings.EMBEDDING_DIMENSION),
            ("memory_embedding", LABEL_MEMORY, "embedding", settings.EMBEDDING_DIMENSION),
            ("chunk_embedding", LABEL_CHUNK, "embedding", settings.EMBEDDING_DIMENSION),
        ]
        
        vector_count = 0
        for idx_name, label, prop, dimension in vector_indexes:
            try:
                # Check if index exists
                check_result = await session.run(get_vector_index_check_query(idx_name))
                existing = await check_result.data()
                
                if existing:
                    logger.debug(f"Vector index '{idx_name}' already exists.")
                    continue
                
                # Create index
                create_query = get_vector_index_create_query(idx_name, label, prop, dimension)
                await session.run(create_query)
                vector_count += 1
                logger.info(f"Created vector index: {idx_name}")
                
            except ClientError as e:
                if _is_already_exists_error(e):
                    logger.debug(f"Vector index '{idx_name}' already exists (race condition).")
                else:
                    logger.error(f"Failed to create vector index {idx_name}: {e}")
                    raise
        
        logger.info(f"Ensured {vector_count} vector indexes.")
