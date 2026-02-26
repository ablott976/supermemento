from pathlib import Path
from app.config import Settings
from app.models.entity import Entity
from app.models.document import Document
from app.models.chunk import Chunk

def test_structure_completeness():
    """F-001: Verify all required files from the story exist."""
    root = Path(__file__).parent.parent
    required = [
        "pyproject.toml",
        "Dockerfile",
        "docker-compose.yml",
        ".env.example",
        ".gitignore",
        "app/config.py",
        "app/__init__.py"
    ]
    for f in required:
        assert (root / f).exists(), f"Missing required file: {f}"

def test_pydantic_settings_coverage():
    """F-001: Verify Pydantic Settings has all essential env vars."""
    settings = Settings()
    # Check for Neo4j settings
    assert hasattr(settings, "NEO4J_URI")
    assert hasattr(settings, "NEO4J_USER")
    assert hasattr(settings, "NEO4J_PASSWORD")
    # Check for API keys
    assert hasattr(settings, "OPENAI_API_KEY")
    assert hasattr(settings, "ANTHROPIC_API_KEY")
    # Check for MCP port
    assert settings.MCP_SERVER_PORT == 8000

def test_docker_multi_stage():
    """F-001: Verify Dockerfile uses multi-stage build and correct python version."""
    dockerfile = Path(__file__).parent.parent / "Dockerfile"
    content = dockerfile.read_text()
    assert content.count("FROM") >= 2, "Dockerfile should be multi-stage"
    assert "python:3.12" in content or "python:3.12-slim" in content

def test_neo4j_schema_compliance():
    """F-001: Verify models match the exact schema from §3."""
    # Entity check
    entity_fields = Entity.model_fields
    assert "name" in entity_fields
    assert "entityType" in entity_fields
    assert "observations" in entity_fields
    assert "embedding" in entity_fields
    assert "created_at" in entity_fields
    assert "updated_at" in entity_fields
    assert "last_accessed_at" in entity_fields
    assert "access_count" in entity_fields
    assert "status" in entity_fields

    # Document check
    doc_fields = Document.model_fields
    assert "id" in doc_fields
    assert "title" in doc_fields
    assert "source_url" in doc_fields
    assert "content_type" in doc_fields
    assert "raw_content" in doc_fields
    assert "container_tag" in doc_fields
    assert "metadata" in doc_fields
    assert "status" in doc_fields
    assert "created_at" in doc_fields
    assert "updated_at" in doc_fields

    # Chunk check
    chunk_fields = Chunk.model_fields
    assert "id" in chunk_fields
    assert "content" in chunk_fields
    assert "token_count" in chunk_fields
    assert "chunk_index" in chunk_fields
    assert "embedding" in chunk_fields
    assert "container_tag" in chunk_fields
    assert "metadata" in chunk_fields
    assert "source_doc_id" in chunk_fields
    assert "created_at" in chunk_fields

def test_env_example_matches_settings():
    """F-001: Verify .env.example contains what Settings expects."""
    root = Path(__file__).parent.parent
    env_example = (root / ".env.example").read_text()
    
    # These are the absolute minimums required by the blueprint
    essential = [
        "NEO4J_URI",
        "NEO4J_USER",
        "NEO4J_PASSWORD",
        "OPENAI_API_KEY",
        "ANTHROPIC_API_KEY"
    ]
    for key in essential:
        assert f"{key}=" in env_example, f".env.example missing {key}"
