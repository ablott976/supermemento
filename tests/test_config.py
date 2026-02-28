import os
import pytest

# Set RUNNING_TESTS environment variable to bypass the check in app/config.py during import.
# NEO4J_PASSWORD will be managed by monkeypatch within each test function.
os.environ["RUNNING_TESTS"] = "1"

from app.config import Settings, validate_config

def test_settings_load(monkeypatch):
    """Test that default settings load correctly when NEO4J_PASSWORD is provided."""
    monkeypatch.setenv("NEO4J_PASSWORD", "test_neo4j_password_for_pytest")
    
    s = Settings()
    assert s.MCP_SERVER_PORT == 8000
    assert s.LOG_LEVEL == "info"
    assert s.HAIKU_MODEL == "claude-3-haiku-20240307"
    assert s.NEO4J_PASSWORD == "test_neo4j_password_for_pytest"

def test_settings_env_override(monkeypatch):
    """Test that environment variables override default settings."""
    monkeypatch.setenv("MCP_SERVER_PORT", "9000")
    monkeypatch.setenv("LOG_LEVEL", "debug")
    monkeypatch.setenv("NEO4J_URI", "bolt://localhost:7687")
    monkeypatch.setenv("NEO4J_PASSWORD", "overridden_password") # Override the default test password
    monkeypatch.setenv("FIRECRAWL_API_KEY", "fc-test-key")
    
    s = Settings()
    assert s.MCP_SERVER_PORT == 9000
    assert s.LOG_LEVEL == "debug"
    assert s.NEO4J_URI == "bolt://localhost:7687"
    assert s.NEO4J_PASSWORD == "overridden_password"
    assert s.FIRECRAWL_API_KEY == "fc-test-key"

def test_settings_default_models(monkeypatch):
    """Verify default AI models match BLUEPRINT.md."""
    monkeypatch.setenv("NEO4J_PASSWORD", "test_neo4j_password_for_pytest") # Ensure password is set
    s = Settings()
    assert s.EMBEDDING_MODEL == "text-embedding-3-large"
    assert s.EMBEDDING_DIMENSION == 3072
    assert "claude-3-5-sonnet" in s.SONNET_MODEL
    assert "claude-3-haiku" in s.HAIKU_MODEL
    assert s.NEO4J_PASSWORD == "test_neo4j_password_for_pytest"

def test_neo4j_password_validation_fails_on_weak_default(monkeypatch):
    """Test that validate_config raises an error for the weak default 'password'."""
    # Set NEO4J_PASSWORD to the weak default for this test.
    # RUNNING_TESTS is set globally, so app/config.py's initial check is bypassed.
    monkeypatch.setenv("NEO4J_PASSWORD", "password")
    
    # Instantiate Settings. This should now work because NEO4J_PASSWORD is set.
    s = Settings()
    assert s.NEO4J_PASSWORD == "password"
    
    # Explicitly check the validation function, which should now be triggered.
    with pytest.raises(ValueError, match="NEO4J_PASSWORD cannot be the weak default 'password'. Please set a strong password."):
        validate_config(s)

def test_neo4j_password_validation_passes_on_strong_password(monkeypatch):
    """Test that validate_config passes with a strong password."""
    # Set NEO4J_PASSWORD to a strong password for this test.
    monkeypatch.setenv("NEO4J_PASSWORD", "a_strong_and_secure_password_123!")
    
    s = Settings()
    assert s.NEO4J_PASSWORD == "a_strong_and_secure_password_123!"
    
    # Explicitly call the validation function, it should not raise an error.
    try:
        validate_config(s)
    except ValueError:
        pytest.fail("validate_config raised ValueError unexpectedly with a strong password.")

# Clean up the globally set RUNNING_TESTS environment variable after all tests.
# monkeypatch within tests handles its own scope.
if "RUNNING_TESTS" in os.environ and os.environ["RUNNING_TESTS"] == "1":
    del os.environ["RUNNING_TESTS"]
