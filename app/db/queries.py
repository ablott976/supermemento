
# Constraints queries
CONSTRAINTS = [
    "CREATE CONSTRAINT entity_name IF NOT EXISTS FOR (e:Entity) REQUIRE e.name IS UNIQUE",
    "CREATE CONSTRAINT memory_id IF NOT EXISTS FOR (m:Memory) REQUIRE m.id IS UNIQUE",
    "CREATE CONSTRAINT document_id IF NOT EXISTS FOR (d:Document) REQUIRE d.id IS UNIQUE",
    "CREATE CONSTRAINT chunk_id IF NOT EXISTS FOR (c:Chunk) REQUIRE c.id IS UNIQUE",
    "CREATE CONSTRAINT user_id IF NOT EXISTS FOR (u:User) REQUIRE u.user_id IS UNIQUE"
]

# Standard indexes queries
INDEXES = [
    "CREATE INDEX memory_container IF NOT EXISTS FOR (m:Memory) ON (m.container_tag)",
    "CREATE INDEX memory_latest IF NOT EXISTS FOR (m:Memory) ON (m.is_latest)",
    "CREATE INDEX memory_type IF NOT EXISTS FOR (m:Memory) ON (m.memory_type)",
    "CREATE INDEX document_status IF NOT EXISTS FOR (d:Document) ON (d.status)"
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

# Entity Queries
CREATE_ENTITY = """
MERGE (e:Entity {name: $name})
ON CREATE SET 
    e.entityType = $entityType,
    e.observations = $observations,
    e.embedding = $embedding,
    e.status = $status,
    e.access_count = $access_count,
    e.created_at = $created_at,
    e.updated_at = $updated_at,
    e.last_accessed_at = $last_accessed_at
ON MATCH SET
    e.entityType = $entityType,
    e.observations = e.observations + [obs IN $observations WHERE NOT obs IN e.observations],
    e.updated_at = $updated_at
RETURN e
"""

LINK_ENTITY_TO_USER = """
MATCH (e:Entity {name: $name})
MATCH (u:User {user_id: $user_id})
MERGE (e)-[:BELONGS_TO]->(u)
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
MATCH (d:Document {id: $source_doc_id})
MERGE (c)-[:PART_OF]->(d)
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

LINK_MEMORY_TO_DOCUMENT = """
MATCH (m:Memory {id: $id})
MATCH (d:Document {id: $source_doc_id})
MERGE (m)-[:EXTRACTED_FROM {extracted_at: $extracted_at}]->(d)
"""

# Relationship Queries
CREATE_MEMORY_UPDATE = """
MATCH (new:Memory {id: $new_id})
MATCH (old:Memory {id: $old_id})
MERGE (new)-[r:UPDATES {classified_at: $classified_at, confidence: $confidence}]->(old)
SET old.is_latest = false
"""

CREATE_MEMORY_EXTEND = """
MATCH (new:Memory {id: $new_id})
MATCH (old:Memory {id: $old_id})
MERGE (new)-[r:EXTENDS {classified_at: $classified_at, confidence: $confidence}]->(old)
"""

CREATE_MEMORY_DERIVE = """
MATCH (derived:Memory {id: $derived_id})
MATCH (m1:Memory {id: $m1_id})
MATCH (m2:Memory {id: $m2_id})
MERGE (derived)-[:DERIVES {classified_at: $classified_at, confidence: $confidence}]->(m1)
MERGE (derived)-[:DERIVES {classified_at: $classified_at, confidence: $confidence}]->(m2)
"""

CREATE_ENTITY_RELATION = """
MATCH (from:Entity {name: $from_name})
MATCH (to:Entity {name: $to_name})
MERGE (from)-[r:RELATES_TO {relationType: $relationType}]->(to)
RETURN r
"""

ADD_OBSERVATIONS = """
MATCH (e:Entity {name: $name})
SET e.observations = e.observations + [obs IN $observations WHERE NOT obs IN e.observations],
    e.updated_at = $updated_at
RETURN e
"""

UPDATE_ENTITY_ACCESS = """
MATCH (e:Entity {name: $name})
SET e.access_count = e.access_count + 1,
    e.last_accessed_at = $last_accessed_at
RETURN e
"""

# Embedding Persistence Queries
SET_ENTITY_EMBEDDING = """
MATCH (e:Entity {name: $name})
SET e.embedding = $embedding, e.updated_at = $updated_at
RETURN e
"""

GET_ENTITY_EMBEDDING = """
MATCH (e:Entity {name: $name})
RETURN e.embedding as embedding
"""

SET_MEMORY_EMBEDDING = """
MATCH (m:Memory {id: $id})
SET m.embedding = $embedding
RETURN m
"""

GET_MEMORY_EMBEDDING = """
MATCH (m:Memory {id: $id})
RETURN m.embedding as embedding
"""

SET_CHUNK_EMBEDDING = """
MATCH (c:Chunk {id: $id})
SET c.embedding = $embedding
RETURN c
"""

GET_CHUNK_EMBEDDING = """
MATCH (c:Chunk {id: $id})
RETURN c.embedding as embedding
"""
