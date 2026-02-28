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
ON CREATE SET e.entityType = $entityType, e.observations = $observations, e.embedding = $embedding, e.status = $status, e.access_count = $access_count, e.created_at = $created_at, e.updated_at = $updated_at, e.last_accessed_at = $last_accessed_at
ON MATCH SET e.entityType = $entityType, e.observations = e.observations + [obs IN $observations WHERE NOT obs IN e.observations], e.updated_at = $updated_at
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
MATCH (d:Document)-[:BELONGS_TO]->(:User {user_id: $user_id})
WHERE d.container_tag = $container_tag
RETURN d
ORDER BY d.created_at DESC
LIMIT $limit
"""

UPDATE_DOCUMENT_STATUS = """
MATCH (d:Document {id: $id})
SET d.status = $status, d.updated_at = $updated_at
RETURN d
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
MATCH (c:Chunk {id: $id})
MATCH (d:Document {id: $doc_id})
MERGE (c)-[:PART_OF]->(d)
"""

GET_CHUNKS_BY_DOCUMENT = """
MATCH (c:Chunk)-[:PART_OF]->(d:Document {id: $doc_id})
RETURN c
ORDER BY c.chunk_index ASC
"""

DELETE_CHUNKS_BY_DOCUMENT = """
MATCH (c:Chunk)-[:PART_OF]->(d:Document {id: $doc_id})
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
MATCH (m:Memory {id: $id})
MATCH (u:User {user_id: $user_id})
MERGE (m)-[:BELONGS_TO]->(u)
"""

LINK_MEMORY_UPDATE = """
MATCH (m:Memory {id: $id})
MATCH (prev:Memory {id: $previous_id})
MERGE (m)-[:UPDATES]->(prev)
SET prev.is_latest = false, prev.valid_to = $valid_from
"""

GET_MEMORY = """
MATCH (m:Memory {id: $id})
RETURN m
"""

GET_LATEST_MEMORIES = """
MATCH (m:Memory)-[:BELONGS_TO]->(:User {user_id: $user_id})
WHERE m.is_latest = true AND m.forgotten_at IS NULL
RETURN m
ORDER BY m.created_at DESC
LIMIT $limit
"""

GET_MEMORIES_BY_CONTAINER = """
MATCH (m:Memory)-[:BELONGS_TO]->(:User {user_id: $user_id})
WHERE m.container_tag = $container_tag AND m.is_latest = true
RETURN m
ORDER BY m.created_at DESC
LIMIT $limit
"""

FORGET_MEMORY = """
MATCH (m:Memory {id: $id})
SET m.forgotten_at = $forgotten_at, m.is_latest = false
RETURN m
"""

# Relationship Queries
CREATE_ENTITY_RELATIONSHIP = """
MATCH (e1:Entity {name: $from_name})
MATCH (e2:Entity {name: $to_name})
MERGE (e1)-[r:RELATES_TO {type: $rel_type}]->(e2)
ON CREATE SET r.created_at = $created_at, r.weight = $weight
ON MATCH SET r.weight = r.weight + $weight, r.updated_at = $created_at
RETURN r
"""

GET_ENTITY_RELATIONSHIPS = """
MATCH (e:Entity {name: $name})-[r:RELATES_TO]-(other:Entity)
RETURN other, r
ORDER BY r.weight DESC
LIMIT $limit
"""

# Vector Search Queries
VECTOR_SEARCH_ENTITY = """
CALL db.index.vector.queryNodes($index_name, $k, $embedding)
YIELD node, score
WHERE node:Entity AND node.status = 'active'
RETURN node, score
LIMIT $limit
"""

VECTOR_SEARCH_MEMORY = """
CALL db.index.vector.queryNodes($index_name, $k, $embedding)
YIELD node, score
WHERE node:Memory AND node.is_latest = true AND node.forgotten_at IS NULL
RETURN node, score
LIMIT $limit
"""

VECTOR_SEARCH_CHUNK = """
CALL db.index.vector.queryNodes($index_name, $k, $embedding)
YIELD node, score
WHERE node:Chunk
RETURN node, score
LIMIT $limit
"""

# Cleanup Queries
DELETE_FORGOTTEN_MEMORIES = """
MATCH (m:Memory)
WHERE m.forgotten_at < $before_date
DETACH DELETE m
"""

DELETE_INACTIVE_ENTITIES = """
MATCH (e:Entity)
WHERE e.status = 'inactive' AND e.last_accessed_at < $before_date
DETACH DELETE e
"""
