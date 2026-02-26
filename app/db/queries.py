
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
