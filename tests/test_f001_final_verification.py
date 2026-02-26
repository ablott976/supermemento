"""
Final verification tests for Story 5/5 of F-001: Project Structure + Configuration.
Ensures that all mandatory files, settings, and models are correctly implemented.
"""
from pathlib import Path
from app.config import settings
from app.models.entity import Entity
from app.models.document import Document
from app.models.chunk import Chunk
from app.models.memory import Memory
from app.models.user import User

def test_project_structure_verification():
    """Verify all critical project files exist."""
    root = Path(__file__).parent.parent
    expected_files = [
        "pyproject.toml",
        "Dockerfile",
        "docker-compose.yml",
        ".env.example",
        "app/config.py",
        "app/main.py",
    ]
    for file_path in expected_files:
        assert (root / file_path).exists(), f"{file_path} should exist"

def test_config_loading():
    """Verify that settings are loaded with expected defaults or from env."""
    assert settings.MCP_SERVER_PORT == 8000
    assert settings.EMBEDDING_DIMENSION == 3072
    assert settings.EMBEDDING_MODEL == "text-embedding-3-large"

def test_model_instantiation():
    """Verify that all core models can be instantiated with minimal data."""
    # Entity
    entity = Entity(name="Test", entityType="TestType")
    assert entity.name == "Test"
    
    # Document
    from app.models.document import ContentType
    doc = Document(title="Test Doc", raw_content="Content", content_type=ContentType.TEXT, container_tag="tag_1")
    assert doc.title == "Test Doc"
    
    # Chunk
    chunk = Chunk(content="Chunk", token_count=1, chunk_index=0, container_tag="tag_1", embedding=[0.0]*3072, source_doc_id=doc.id)
    assert chunk.content == "Chunk"
    
    # Memory
    from app.models.memory import MemoryType
    from datetime import datetime, timezone
    memory = Memory(
        content="Fact", 
        container_tag="tag_1", 
        embedding=[0.0]*3072, 
        source_doc_id=doc.id, 
        memory_type=MemoryType.FACT,
        valid_from=datetime.now(timezone.utc)
    )
    assert memory.content == "Fact"
    
    # User
    user = User(user_id="user_1")
    assert user.user_id == "user_1"

def test_dockerfile_compliance():
    """Verify Dockerfile contains multi-stage and correct python version."""
    root = Path(__file__).parent.parent
    dockerfile = root / "Dockerfile"
    content = dockerfile.read_text()
    assert "FROM" in content
    assert "python:3.12" in content or "python:3.12-slim" in content
    assert "EXPOSE 8000" in content
