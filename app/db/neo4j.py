"""Async Neo4j connection pool utilities.

This module centralizes lifecycle and pooling configuration for a shared
``neo4j.AsyncDriver`` instance used across the application.
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from typing import Any

try:
    from neo4j import AsyncDriver, AsyncGraphDatabase
except ImportError:  # pragma: no cover - exercised only when dependency missing
    AsyncDriver = Any  # type: ignore[assignment]
    AsyncGraphDatabase = None


class NodeLabels:
    """Standardized Neo4j node labels."""

    ENTITY = "Entity"
    DOCUMENT = "Document"
    CHUNK = "Chunk"
    MEMORY = "Memory"
    USER = "User"


class EntityProperties:
    """Standardized property keys for Entity nodes."""

    NAME = "name"
    OBSERVATIONS = "observations"
    EMBEDDING = "embedding"


class DocumentProperties:
    """Standardized property keys for Document nodes."""

    ID = "id"
    TITLE = "title"
    CONTENT_TYPE = "contentType"
    RAW_CONTENT = "rawContent"
    SOURCE_URL = "sourceUrl"
    FILE_PATH = "filePath"
    CONTAINER_TAG = "containerTag"
    METADATA = "metadata"
    STATUS = "status"
    CREATED_AT = "createdAt"
    UPDATED_AT = "updatedAt"


class ChunkProperties:
    """Standardized property keys for Chunk nodes."""

    ID = "id"
    CONTENT = "content"
    EMBEDDING = "embedding"
    CHUNK_INDEX = "chunkIndex"
    CONTAINER_TAG = "containerTag"
    METADATA = "metadata"
    SOURCE_DOC_ID = "sourceDocId"


class MemoryProperties:
    """Standardized property keys for Memory nodes."""

    ID = "id"
    CONTENT = "content"
    MEMORY_TYPE = "memoryType"
    CONTAINER_TAG = "containerTag"
    IS_LATEST = "isLatest"
    CONFIDENCE = "confidence"
    ORIGINAL_CONFIDENCE = "originalConfidence"
    EMBEDDING = "embedding"
    VALID_FROM = "validFrom"
    VALID_TO = "validTo"
    FORGOTTEN_AT = "forgottenAt"
    CREATED_AT = "createdAt"
    SOURCE_DOC_ID = "sourceDocId"


class UserProperties:
    """Standardized property keys for User nodes."""

    ID = "id"
    CONTAINER_TAG = "containerTag"
    NAME = "name"
    EMAIL = "email"
    METADATA = "metadata"
    CREATED_AT = "createdAt"
    UPDATED_AT = "updatedAt"


CONSTRAINTS_AND_INDEXES: tuple[str, ...] = (
    (
        "CREATE CONSTRAINT memory_id IF NOT EXISTS "
        f"FOR (m:{NodeLabels.MEMORY}) REQUIRE m.{MemoryProperties.ID} IS UNIQUE"
    ),
    (
        "CREATE CONSTRAINT document_id IF NOT EXISTS "
        f"FOR (d:{NodeLabels.DOCUMENT}) REQUIRE d.{DocumentProperties.ID} IS UNIQUE"
    ),
    (
        "CREATE CONSTRAINT chunk_id IF NOT EXISTS "
        f"FOR (c:{NodeLabels.CHUNK}) REQUIRE c.{ChunkProperties.ID} IS UNIQUE"
    ),
    (
        "CREATE CONSTRAINT profile_container IF NOT EXISTS "
        "FOR (p:Profile) REQUIRE p.containerTag IS UNIQUE"
    ),
    (
        "CREATE CONSTRAINT container_config_tag IF NOT EXISTS "
        "FOR (c:ContainerConfig) REQUIRE c.containerTag IS UNIQUE"
    ),
    (
        "CREATE INDEX memory_container IF NOT EXISTS "
        f"FOR (m:{NodeLabels.MEMORY}) ON (m.{MemoryProperties.CONTAINER_TAG})"
    ),
    (
        "CREATE INDEX memory_latest IF NOT EXISTS "
        f"FOR (m:{NodeLabels.MEMORY}) ON (m.{MemoryProperties.IS_LATEST})"
    ),
    (
        "CREATE INDEX memory_type IF NOT EXISTS "
        f"FOR (m:{NodeLabels.MEMORY}) ON (m.{MemoryProperties.MEMORY_TYPE})"
    ),
    (
        "CREATE INDEX document_status IF NOT EXISTS "
        f"FOR (d:{NodeLabels.DOCUMENT}) ON (d.{DocumentProperties.STATUS})"
    ),
)


VECTOR_INDEXES: tuple[tuple[str, str, str], ...] = (
    ("memory_embeddings", NodeLabels.MEMORY, MemoryProperties.EMBEDDING),
    ("chunk_embeddings", NodeLabels.CHUNK, ChunkProperties.EMBEDDING),
)


class Neo4jConnectionPool:
    """Manage a single async Neo4j driver with pooling configuration."""

    def __init__(
        self,
        uri: str | None = None,
        user: str | None = None,
        password: str | None = None,
        database: str | None = None,
        max_connection_pool_size: int | None = None,
        connection_timeout: float | None = None,
        max_connection_lifetime: int | None = None,
    ) -> None:
        self._uri = uri or os.getenv("NEO4J_URI", "bolt://localhost:7687")
        self._user = user or os.getenv("NEO4J_USER", "neo4j")
        self._password = password or os.getenv("NEO4J_PASSWORD", "password")
        self._database = database or os.getenv("NEO4J_DATABASE", "neo4j")
        self._max_connection_pool_size = max_connection_pool_size or int(
            os.getenv("NEO4J_MAX_CONNECTION_POOL_SIZE", "50")
        )
        self._connection_timeout = connection_timeout or float(
            os.getenv("NEO4J_CONNECTION_TIMEOUT", "30")
        )
        self._max_connection_lifetime = max_connection_lifetime or int(
            os.getenv("NEO4J_MAX_CONNECTION_LIFETIME", "3600")
        )
        self._driver: AsyncDriver | None = None

    async def connect(self) -> AsyncDriver:
        """Initialize and validate the shared async driver."""
        if self._driver is not None:
            return self._driver

        if AsyncGraphDatabase is None:
            raise RuntimeError(
                "neo4j package is not installed; cannot initialize async driver"
            )

        self._driver = AsyncGraphDatabase.driver(
            self._uri,
            auth=(self._user, self._password),
            max_connection_pool_size=self._max_connection_pool_size,
            connection_timeout=self._connection_timeout,
            max_connection_lifetime=self._max_connection_lifetime,
        )
        await self._driver.verify_connectivity()
        return self._driver

    async def close(self) -> None:
        """Close the shared driver and release pooled connections."""
        if self._driver is None:
            return
        await self._driver.close()
        self._driver = None

    async def setup_constraints_and_indexes(self) -> None:
        """Create required constraints and indexes in an idempotent way."""
        async with self.session() as session:
            for statement in CONSTRAINTS_AND_INDEXES:
                await session.run(statement)

            for index_name, label, property_name in VECTOR_INDEXES:
                await ensure_vector_index(
                    session=session,
                    index_name=index_name,
                    label=label,
                    property_name=property_name,
                )

    @asynccontextmanager
    async def session(self, **kwargs: Any):
        """Yield an async Neo4j session from the pooled shared driver."""
        driver = await self.connect()
        session_kwargs = {"database": self._database, **kwargs}
        session = driver.session(**session_kwargs)
        try:
            yield session
        finally:
            await session.close()


_neo4j_pool = Neo4jConnectionPool()


async def get_neo4j_driver() -> AsyncDriver:
    """Return the shared async Neo4j driver instance."""
    return await _neo4j_pool.connect()


@asynccontextmanager
async def get_neo4j_session(**kwargs: Any):
    """Provide an async Neo4j session backed by the shared pool."""
    async with _neo4j_pool.session(**kwargs) as session:
        yield session


async def close_neo4j_driver() -> None:
    """Shutdown hook for closing pooled Neo4j connections."""
    await _neo4j_pool.close()


async def setup_neo4j_constraints_and_indexes() -> None:
    """Run idempotent schema creation for constraints and indexes."""
    await _neo4j_pool.setup_constraints_and_indexes()


async def ensure_vector_index(
    *,
    session: Any,
    index_name: str,
    label: str,
    property_name: str,
    dimensions: int = 3072,
    similarity_function: str = "cosine",
) -> None:
    """Create a vector index if it does not already exist."""
    lookup = await session.run(
        "SHOW INDEXES YIELD name WHERE name = $name RETURN count(*) AS count",
        name=index_name,
    )
    record = await lookup.single()
    count = int(record["count"]) if record is not None else 0
    if count > 0:
        return

    await session.run(
        "CREATE VECTOR INDEX "
        f"{index_name} "
        "IF NOT EXISTS "
        f"FOR (n:{label}) "
        f"ON (n.{property_name}) "
        "OPTIONS { indexConfig: { "
        f"`vector.dimensions`: {dimensions}, "
        f"`vector.similarity_function`: '{similarity_function}' "
        "} }"
    )
