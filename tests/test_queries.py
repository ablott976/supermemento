from app.db.queries import CONSTRAINTS, INDEXES, get_vector_index_check_query, get_vector_index_create_query

def test_constraints_format():
    """Verify that constraint queries are well-formed strings."""
    assert len(CONSTRAINTS) == 5
    for query in CONSTRAINTS:
        assert query.startswith("CREATE CONSTRAINT")
        assert "IF NOT EXISTS" in query
        assert "UNIQUE" in query
    
    # Verify specific user_id constraint
    assert any("u:User" in q and "u.user_id" in q for q in CONSTRAINTS)

def test_indexes_format():
    """Verify that index queries are well-formed strings."""
    assert len(INDEXES) == 4
    for query in INDEXES:
        assert query.startswith("CREATE INDEX")
        assert "IF NOT EXISTS" in query

def test_vector_index_queries():
    """Verify vector index helper functions."""
    check = get_vector_index_check_query("test_index")
    assert "test_index" in check
    assert check.startswith("SHOW INDEXES")
    
    create = get_vector_index_create_query("test_index", "TestLabel", "test_prop", 3072)
    assert "test_index" in create
    assert "TestLabel" in create
    assert "test_prop" in create
    assert "3072" in create
    assert "db.index.vector.createNodeIndex" in create
