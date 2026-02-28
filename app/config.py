import os
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Neo4j configuration
    NEO4J_URI: str = "bolt://neo4j:7687"
    NEO4J_USER: str = "neo4j"
    NEO4J_PASSWORD: str | None = None

    # API Keys
    OPENAI_API_KEY: str | None = None
    ANTHROPIC_API_KEY: str | None = None
    FIRECRAWL_API_KEY: str | None = None

    # Server configuration
    MCP_SERVER_PORT: int = 8000
    LOG_LEVEL: str = "info"

    # AI Models (defaults from BLUEPRINT.md)
    EMBEDDING_MODEL: str = "text-embedding-3-large"
    EMBEDDING_DIMENSION: int = 3072
    SONNET_MODEL: str = "claude-3-5-sonnet-20240620"
    HAIKU_MODEL: str = "claude-3-haiku-20240307"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


def validate_config(settings: Settings):
    """
    Validates configuration settings.
    """
    # Validate Neo4j password
    if settings.NEO4J_PASSWORD == 'password':
        raise ValueError("NEO4J_PASSWORD cannot be the weak default 'password'. Please set a strong password.")

    if settings.NEO4J_PASSWORD is None and not os.getenv("RUNNING_TESTS"):
        # Check if running in a CI environment where .env might not be present
        # and the variable might be set differently. For local development or
        # production, it must be explicitly set.
        if not os.getenv("CI"):
            raise ValueError("NEO4J_PASSWORD environment variable not set.")
        # If in CI and not set, this might indicate a problem with the CI setup itself.
        elif not os.getenv("NEO4J_PASSWORD"):
            raise ValueError("NEO4J_PASSWORD environment variable not set in CI environment.")

# Instantiate settings and validate
settings = Settings()
validate_config(settings)

