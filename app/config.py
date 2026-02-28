import warnings

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Neo4j configuration
    NEO4J_URI: str = "bolt://neo4j:7687"
    NEO4J_USER: str = "neo4j"
    NEO4J_PASSWORD: str = "password"

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

    @field_validator("NEO4J_PASSWORD")
    @classmethod
    def validate_neo4j_password(cls, v: str) -> str:
        """Warn if default password is used in production."""
        if v == "password":
            warnings.warn(
                "Security: Using default Neo4j password 'password'. "
                "Set NEO4J_PASSWORD environment variable for production use.",
                stacklevel=2,
            )
        return v


settings = Settings()
