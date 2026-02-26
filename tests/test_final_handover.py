from pathlib import Path
from app.config import settings
from app.models.entity import Entity
from app.models.document import Document, ContentType
from app.models.memory import Memory, MemoryType
from app.models.user import User
from app.db.queries import CONSTRAINTS, INDEXES

def test_final_structure_check():
    """Final verification of the project structure."""
    root = Path(__file__).parent.parent
    files = [
        "pyproject.toml",
        "Dockerfile",
        "docker-compose.yml",
        ".env.example",
        "app/config.py",
        "app/main.py",
        "app/db/neo4j.py",
        "app/db/queries.py",
    ]
    for f in files:
        assert (root / f).exists(), f"File {f} is missing"

def test_final_config_check():
    """Final verification of the configuration defaults."""
    assert settings.MCP_SERVER_PORT == 8000
    assert settings.EMBEDDING_DIMENSION == 3072
    assert settings.NEO4J_USER == "neo4j"

def test_final_models_check():
    """Final verification of model property alignment with blueprint."""
    # Entity
    e = Entity(name="Test", entityType="Type")
    assert hasattr(e, "observations")
    assert hasattr(e, "embedding")
    assert hasattr(e, "status")
    
    # Document
    d = Document(title="Doc", raw_content="Raw", content_type=ContentType.TEXT, container_tag="tag")
    assert hasattr(d, "source_url")
    assert hasattr(d, "metadata")
    
    # Memory
    m = Memory(content="Fact", memory_type=MemoryType.FACT, container_tag="tag", source_doc_id=d.id, valid_from=d.created_at)
    assert hasattr(m, "confidence")
    assert hasattr(m, "is_latest")
    
    # User
    u = User(user_id="user1")
    assert u.user_id == "user1"

def test_final_db_queries_check():
    """Final verification of DB initialization queries."""
    assert len(CONSTRAINTS) == 5
    assert len(INDEXES) == 4
    assert any("Entity" in q and "name" in q for q in CONSTRAINTS)
    assert any("User" in q and "user_id" in q for q in CONSTRAINTS)

def test_final_docker_check():
    """Final verification of Docker configuration."""
    dockerfile = Path(__file__).parent.parent / "Dockerfile"
    content = dockerfile.read_text()
    assert "FROM python:3.12" in content
    assert "EXPOSE 8000" in content
    
    docker_compose = Path(__file__).parent.parent / "docker-compose.yml"
    compose_content = docker_compose.read_text()
    assert "neo4j:5" in compose_content
    assert "8000:8000" in compose_content
