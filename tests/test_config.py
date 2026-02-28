"""
Tests for application configuration and environment variable loading.
Includes verification for Issue #39: Ensuring NEO4J_PASSWORD is required and validated.
"""
from app.config import Settings
from pydantic import ValidationError
import pytest

def test_settings_load(monkeypatch):
    monkeypatch.setenv("NEO4J_PASSWORD", "test-password-default")
    settings = Settings()
    assert settings.MCP_SERVER_PORT == 8000
    assert settings.LOG_LEVEL == "info"
    assert settings.NEO4J_PASSWORD == "test-password-default"
    assert settings.HAIKU_MODEL == "claude-3-haiku-20240307"

def test_settings_env_override(monkeypatch):
    """Test that environment variables override default settings."""
    monkeypatch.setenv("MCP_SERVER_PORT", "9000")
    monkeypatch.setenv("LOG_LEVEL", "debug")
    monkeypatch.setenv("NEO4J_URI", "bolt://localhost:7687")
    monkeypatch.setenv("NEO4J_PASSWORD", "test-password")
    monkeypatch.setenv("FIRECRAWL_API_KEY", "fc-test-key")
    
    settings = Settings()
    assert settings.MCP_SERVER_PORT == 9000
    assert settings.LOG_LEVEL == "debug"
    assert settings.NEO4J_URI == "bolt://localhost:7687"
    assert settings.NEO4J_PASSWORD == "test-password"
    assert settings.FIRECRAWL_API_KEY == "fc-test-key"

def test_settings_default_models():
    """Verify default AI models match BLUEPRINT.md."""
    settings = Settings()
    assert settings.EMBEDDING_MODEL == "text-embedding-3-large"
    assert settings.EMBEDDING_DIMENSION == 3072
    assert "claude-3-5-sonnet" in settings.SONNET_MODEL
    assert "claude-3-haiku" in settings.HAIKU_MODEL

def test_missing_neo4j_password(monkeypatch):
    """Test that configuration fails if NEO4J_PASSWORD is not set."""
    # Ensure NEO4J_PASSWORD is not set in the environment for this test
    monkeypatch.delenv("NEO4J_PASSWORD", raising=False)
    
    # Expect a ValidationError when trying to instantiate Settings without the required password
    with pytest.raises(ValidationError):
        Settings()
    
    # Optional: Add more specific checks on the error message if needed
    # assert "NEO4J_PASSWORD" in str(excinfo.value)

def test_invalid_neo4j_password_length(monkeypatch):
    """Test that configuration fails if NEO4J_PASSWORD is too short."""
    # Set NEO4J_PASSWORD to a value less than the required minimum length (8)
    short_password = "short"
    monkeypatch.setenv("NEO4J_PASSWORD", short_password)
    
    # Expect a ValidationError when trying to instantiate Settings with a short password
    with pytest.raises(ValidationError) as excinfo:
        Settings()
        
    # Assert that the error message indicates a length issue for NEO4J_PASSWORD
    assert "NEO4J_PASSWORD" in str(excinfo.value)
    assert "String should have at least 8 characters" in str(excinfo.value)

def test_valid_neo4j_password_configuration(monkeypatch):
    """Test that configuration succeeds with a valid NEO4J_PASSWORD."""
    valid_password = "a_very_secure_password_123"  # Meets min_length=8 requirement
    monkeypatch.setenv("NEO4J_PASSWORD", valid_password)
    
    # Instantiate Settings. This should not raise a ValidationError.
    settings = Settings()
    
    # Assert that the NEO4J_PASSWORD is correctly loaded
    assert settings.NEO4J_PASSWORD == valid_password

def test_empty_neo4j_password(monkeypatch):
    """Test that configuration fails if NEO4J_PASSWORD is an empty string."""
    # Set NEO4J_PASSWORD to an empty string
    empty_password = ""
    monkeypatch.setenv("NEO4J_PASSWORD", empty_password)
    
    # Expect a ValidationError when trying to instantiate Settings with an empty password
    with pytest.raises(ValidationError) as excinfo:
        Settings()
        
    # Assert that the error message indicates a length issue for NEO4J_PASSWORD
    assert "NEO4J_PASSWORD" in str(excinfo.value)
    assert "String should have at least 8 characters" in str(excinfo.value)
