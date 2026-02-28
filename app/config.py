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
    # Raise an error if NEO4J_PASSWORD is not set
    if settings.NEO4J_PASSWORD is None and not os.getenv("RUNNING_TESTS"):
        raise ValueError("NEO4J_PASSWORD environment variable must be set.")

    # Validate Neo4j password is not the weak default
    if settings.NEO4J_PASSWORD == 'password':
        raise ValueError("NEO4J_PASSWORD cannot be the weak default 'password'. Please set a strong password.")

# Instantiate settings and validate
settings = Settings()
validate_config(settings)

