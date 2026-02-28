# Constraints queries - Neo4j 5.x syntax
CONSTRAINTS = [
    "CREATE CONSTRAINT entity_name IF NOT EXISTS FOR (e:Entity) REQUIRE e.name IS UNIQUE",
    "CREATE CONSTRAINT memory_id IF NOT EXISTS FOR (m:Memory) REQUIRE m.id IS UNIQUE",
    "CREATE CONSTRAINT document_id IF NOT EXISTS FOR (d:Document) REQUIRE d.id IS UNIQUE",
    "CREATE CONSTRAINT chunk_id IF NOT EXISTS FOR (c:Chunk) REQUIRE c.id IS UNIQUE",
    "CREATE CONSTRAINT user_id IF NOT EXISTS FOR (u:User) REQUIRE u.user_id IS UNIQUE"
]

# Standard indexes queries - Neo4j 5.x range indexes
INDEXES = [
    # Memory indexes for filtering and retrieval
    "CREATE INDEX memory_container IF NOT EXISTS FOR (m:Memory) ON (m.container_tag)",
    "CREATE INDEX memory_latest IF NOT EXISTS FOR (m:Memory) ON (m.is_latest)",
    "CREATE INDEX memory_type IF NOT EXISTS FOR (m:Memory) ON (m.memory_type)",
    "CREATE INDEX memory_source_doc IF NOT EXISTS FOR (m:Memory) ON (m.source_doc_id)",
    "CREATE INDEX memory_forgotten_at IF NOT EXISTS FOR (m:Memory) ON (m.forgotten_at)",
    "CREATE INDEX memory_valid_to IF NOT EXISTS FOR (m:Memory) ON (m.valid_to)",
    "CREATE INDEX memory_created_at IF NOT EXISTS FOR (m:Memory) ON (m.created_at)",
    # Document indexes
    "CREATE INDEX document_status IF NOT EXISTS FOR (d:Document) ON (d.status)",
    "CREATE INDEX document_container IF NOT EXISTS FOR (d:Document) ON (d.container_tag)",
    "CREATE INDEX document_created_at IF NOT EXISTS FOR (d:Document) ON (d.created_at)",
    # Chunk indexes for document retrieval and cleanup
    "CREATE INDEX chunk_source_doc IF NOT EXISTS FOR (c:Chunk) ON (c.source_doc_id)",
    "CREATE INDEX chunk_container IF NOT EXISTS FOR (c:Chunk) ON (c.container_tag)",
    "CREATE INDEX chunk_created_at IF NOT EXISTS FOR (c:Chunk) ON (c.created_at)",
    # Entity indexes for filtering and access patterns
    "CREATE INDEX entity_status IF NOT EXISTS FOR (e:Entity) ON (e.status)",
    "CREATE INDEX entity_type IF NOT EXISTS FOR (e:Entity) ON (e.entityType)",
    "CREATE INDEX entity_created_at IF NOT EXISTS FOR (e:Entity) ON (e.created_at)",
    "CREATE INDEX entity_last_accessed IF NOT EXISTS FOR (e:Entity) ON (e.last_accessed_at)",
    # User indexes for activity tracking
    "CREATE INDEX user_last_active IF NOT EXISTS FOR (u:User) ON (u.last_active_at)",
    "CREATE INDEX user_created_at IF NOT EXISTS FOR (u:User) ON (u.created_at)"
]

# Vector index templates
def get_vector_index_check_query(name: str) -> str:
    """Returns a query to check if a vector index exists."""
    return f"SHOW INDEXES YIELD name WHERE name = '{name}'"


def get_vector_index_create_query(name: str, label: str, prop: str, dimension: int) -> str:
    """Returns a query to create a vector index."""
    return f"CALL db.index.vector.createNodeIndex('{name}', '{label}', '{prop}', {dimension}, 'cosine')"


# --- CRUD Queries ---

# User Queries
CREATE_USER = """
MERGE (u:User {user_id: $user_id})
ON CREATE SET u.created_at = $created_at, u.last_active_at = $last_active_at
ON MATCH SET u.last_active_at = $last_active_at
RETURN u
"""

GET_USER = """
MATCH (u:User {user_id: $user_id})
RETURN u
"""

# Entity Queries
CREATE_ENTITY = """
MERGE (e:Entity {name: $name})
ON CREATE SET e.entityType = $entityType, 
              e.observations = $observations, 
              e.embedding = $embedding,
              e.status = $status,
              e.access_count = $access_count,
              e.created_at = $created_at,
              e.updated_at = $updated_at,
              e.last_accessed_at = $last_accessed_at
ON MATCH SET e.entityType = $entityType,
             e.observations = e.observations + [obs IN $observations WHERE NOT obs IN e.observations],
             e.updated_at = $updated_at
RETURN e
"""

LINK_ENTITY_TO_USER = """
MATCH (e:Entity {name: $name})
MATCH (u:User {user_id: $user_id})
MERGE (e)-[:BELONGS_TO]->(u)
"""

GET_ENTITY = """
MATCH (e:Entity {name: $name})
RETURN e
"""

UPDATE_ENTITY_ACCESS = """
MATCH (e:Entity {name: $name})
SET e.last_accessed_at = $last_accessed_at, e.access_count = e.access_count + 1
RETURN e
"""

GET_ENTITIES_BY_TYPE = """
MATCH (e:Entity {entityType: $entity_type})
RETURN e
ORDER BY e.last_accessed_at DESC
LIMIT $limit
"""

GET_ENTITIES_BY_CONTAINER = """
MATCH (e:Entity)-[:BELONGS_TO]->(:User {user_id: $user_id})
WHERE e.container_tag = $container_tag
RETURN e
ORDER BY e.last_accessed_at DESC
LIMIT $limit
"""

# Document Queries
CREATE_DOCUMENT = """
CREATE (d:Document {
    id: $id, 
    title: $title, 
    source_url: $source_url, 
    content_type: $content_type,
    raw_content: $raw_content,
    container_tag: $container_tag,
    metadata: $metadata,
    status: $status,
    created_at: $created_at,
    updated_at: $updated_at
})
RETURN d
"""

LINK_DOCUMENT_TO_USER = """
MATCH (d:Document {id: $id})
MATCH (u:User {user_id: $user_id})
MERGE (d)-[:BELONGS_TO]->(u)
"""

GET_DOCUMENT = """
MATCH (d:Document {id: $id})
RETURN d
"""

GET_DOCUMENTS_BY_CONTAINER = """
MATCH (d:Document {container_tag: $container_tag})
RETURN d
ORDER BY d.created_at DESC
"""

UPDATE_DOCUMENT_STATUS = """
MATCH (d:Document {id: $id})
SET d.status = $status, d.updated_at = $updated_at
RETURN d
"""

DELETE_DOCUMENT_CHUNKS = """
MATCH (c:Chunk {source_doc_id: $doc_id})
DETACH DELETE c
"""

DELETE_DOCUMENT = """
MATCH (d:Document {id: $id})
DETACH DELETE d
"""

# Chunk Queries
CREATE_CHUNK = """
CREATE (c:Chunk {
    id: $id,
    content: $content,
    token_count: $token_count,
    chunk_index: $chunk_index,
    embedding: $embedding,
    container_tag: $container_tag,
    metadata: $metadata,
    source_doc_id: $source_doc_id,
    created_at: $created_at
})
RETURN c
"""

LINK_CHUNK_TO_DOCUMENT = """
MATCH (c:Chunk {id: $chunk_id})
MATCH (d:Document {id: $doc_id})
MERGE (c)-[:PART_OF]->(d)
"""

GET_CHUNKS_BY_DOCUMENT = """
MATCH (c:Chunk {source_doc_id: $doc_id})
RETURN c
ORDER BY c.chunk_index ASC
"""

GET_CHUNK = """
MATCH (c:Chunk {id: $id})
RETURN c
"""

DELETE_CHUNK = """
MATCH (c:Chunk {id: $id})
DETACH DELETE c
"""

# Memory Queries
CREATE_MEMORY = """
CREATE (m:Memory {
    id: $id,
    content: $content,
    memory_type: $memory_type,
    container_tag: $container_tag,
    is_latest: $is_latest,
    confidence: $confidence,
    embedding: $embedding,
    valid_from: $valid_from,
    valid_to: $valid_to,
    forgotten_at: $forgotten_at,
    source_doc_id: $source_doc_id,
    created_at: $created_at
})
RETURN m
"""

LINK_MEMORY_TO_USER = """
MATCH (m:Memory {id: $memory_id})
MATCH (u:User {user_id: $user_id})
MERGE (m)-[:BELONGS_TO]->(u)
"""

LINK_MEMORY_TO_SOURCE = """
MATCH (m:Memory {id: $memory_id})
MATCH (source {id: $source_id})
WHERE source:Document OR source:Chunk OR source:Entity
MERGE (m)-[:EXTRACTED_FROM]->(source)
"""

LINK_MEMORY_PREDECESSOR = """
MATCH (m:Memory {id: $memory_id})
MATCH (prev:Memory {id: $predecessor_id})
MERGE (m)-[:UPDATES]->(prev)
SET prev.is_latest = false, prev.valid_to = $valid_to
"""

GET_MEMORY = """
MATCH (m:Memory {id: $id})
RETURN m
"""

GET_LATEST_MEMORIES = """
MATCH (m:Memory {container_tag: $container_tag, is_latest: true})
WHERE m.forgotten_at IS NULL
AND ($memory_type IS NULL OR m.memory_type = $memory_type)
RETURN m
ORDER BY m.created_at DESC
LIMIT $limit
"""

GET_MEMORIES_BY_SOURCE = """
MATCH (m:Memory)-[:EXTRACTED_FROM]->({id: $source_id})
WHERE m.is_latest = true AND m.forgotten_at IS NULL
RETURN m
ORDER BY m.created_at DESC
"""

FORGET_MEMORY = """
MATCH (m:Memory {id: $id})
SET m.forgotten_at = $forgotten_at, m.is_latest = false, m.valid_to = $forgotten_at
RETURN m
"""

INVALIDATE_OLD_MEMORIES = """
MATCH (m:Memory {container_tag: $container_tag, memory_type: $memory_type})
WHERE m.is_latest = true AND m.id <> $current_id
SET m.is_latest = false, m.valid_to = $valid_to
"""

# Entity Relations
CREATE_ENTITY_RELATION = """
MATCH (e1:Entity {name: $from_name})
MATCH (e2:Entity {name: $to_name})
MERGE (e1)-[r:RELATES_TO {relation_type: $relation_type}]->(e2)
ON CREATE SET r.created_at = $created_at, r.confidence = $confidence, r.metadata = $metadata
ON MATCH SET r.updated_at = $created_at, r.confidence = $confidence, r.metadata = $metadata
RETURN r
"""

GET_ENTITY_RELATIONS = """
MATCH (e:Entity {name: $name})-[r:RELATES_TO]-(other:Entity)
RETURN r, other
ORDER BY r.confidence DESC
LIMIT $limit
"""

GET_RELATED_ENTITIES = """
MATCH (e:Entity {name: $name})-[:RELATES_TO*1..$depth]-(related:Entity)
WHERE related.name <> $name
RETURN DISTINCT related
LIMIT $limit
"""

# Vector Search Queries
SEARCH_ENTITIES_VECTOR = """
CALL db.index.vector.queryNodes('entity_embedding_index', $k, $embedding)
YIELD node, score
RETURN node, score
"""

SEARCH_CHUNKS_VECTOR = """
CALL db.index.vector.queryNodes('chunk_embedding_index', $k, $embedding)
YIELD node, score
RETURN node, score
"""

SEARCH_MEMORIES_VECTOR = """
CALL db.index.vector.queryNodes('memory_embedding_index', $k, $embedding)
YIELD node, score
WHERE node.forgotten_at IS NULL AND node.is_latest = true
RETURN node, score
"""

# Hybrid Search (Vector + Filter)
SEARCH_CHUNKS_BY_CONTAINER_VECTOR = """
CALL db.index.vector.queryNodes('chunk_embedding_index', $k, $embedding)
YIELD node, score
WHERE node.container_tag = $container_tag
RETURN node, score
"""

SEARCH_ENTITIES_BY_TYPE_VECTOR = """
CALL db.index.vector.queryNodes('entity_embedding_index', $k, $embedding)
YIELD node, score
WHERE $entity_type IS NULL OR node.entityType = $entity_type
RETURN node, score
"""

# Graph Traversal for SuperRAG
GET_MEMORY_GRAPH = """
MATCH (m:Memory {id: $memory_id})-[:EXTRACTED_FROM|RELATES_TO*1..2]-(connected)
RETURN connected
"""

GET_ENTITY_SUBGRAPH = """
MATCH path = (e:Entity {name: $name})-[:RELATES_TO*1..$depth]-(other:Entity)
RETURN path
LIMIT $limit
"""

GET_DOCUMENT_GRAPH = """
MATCH (d:Document {id: $doc_id})-[:PART_OF]-(c:Chunk)
OPTIONAL MATCH (c)-[:EXTRACTED_FROM]-(m:Memory)
OPTIONAL MATCH (d)-[:EXTRACTED_FROM]-(e:Entity)
RETURN d, c, m, e
"""

# Cleanup and Maintenance Queries
DELETE_OLD_MEMORIES = """
MATCH (m:Memory)
WHERE m.valid_to < $before_date AND m.forgotten_at IS NOT NULL
WITH m LIMIT $batch_size
DETACH DELETE m
"""

DELETE_ORPHANED_CHUNKS = """
MATCH (c:Chunk)
WHERE NOT (c)-[:PART_OF]->(:Document)
WITH c LIMIT $batch_size
DETACH DELETE c
"""

DELETE_ORPHANED_ENTITIES = """
MATCH (e:Entity)
WHERE NOT (e)-[:BELONGS_TO]->(:User)
WITH e LIMIT $batch_size
DETACH DELETE e
"""

# Stats Queries
GET_ENTITY_STATS = """
MATCH (e:Entity)
RETURN count(e) as total_entities,
       sum(e.access_count) as total_accesses,
       avg(e.access_count) as avg_accesses
"""

GET_MEMORY_STATS = """
MATCH (m:Memory)
RETURN count(m) as total_memories,
       sum(CASE WHEN m.is_latest = true THEN 1 ELSE 0 END) as latest_count,
       sum(CASE WHEN m.forgotten_at IS NOT NULL THEN 1 ELSE 0 END) as forgotten_count
"""

GET_DOCUMENT_STATS = """
MATCH (d:Document)
RETURN count(d) as total_documents,
       sum(CASE WHEN d.status = 'processed' THEN 1 ELSE 0 END) as processed_count
"""

GET_CHUNK_STATS = """
MATCH (c:Chunk)
RETURN count(c) as total_chunks,
       sum(c.token_count) as total_tokens,
       avg(c.token_count) as avg_tokens_per_chunk
"""
