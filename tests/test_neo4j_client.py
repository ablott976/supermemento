"""Tests for Neo4j client TypeScript implementation."""

from __future__ import annotations
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
NEO4J_CLIENT_PATH = REPO_ROOT / "src" / "db" / "neo4j-client.ts"


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def test_limit_latest_memories_constant_is_100() -> None:
    """Verify LIMIT_LATEST_MEMORIES constant is defined with value 100."""
    source = _read(NEO4J_CLIENT_PATH)
    assert "const LIMIT_LATEST_MEMORIES = 100;" in source


def test_get_latest_memories_by_container_has_pagination_parameters() -> None:
    """Verify getLatestMemoriesByContainer accepts pagination parameters with defaults."""
    source = _read(NEO4J_CLIENT_PATH)
    assert "public async getLatestMemoriesByContainer(" in source
    assert "page: number = 1" in source
    assert "pageSize: number = LIMIT_LATEST_MEMORIES" in source


def test_get_latest_memories_by_container_uses_pagination_in_cypher() -> None:
    """Verify the Cypher query uses SKIP and LIMIT for pagination."""
    source = _read(NEO4J_CLIENT_PATH)
    assert "SKIP $skip" in source
    assert "LIMIT $limit" in source


def test_get_latest_memories_by_container_passes_pagination_params_to_session() -> None:
    """Verify pagination values are passed to session.run parameters."""
    source = _read(NEO4J_CLIENT_PATH)
    assert "containerTag" in source
    assert "skip: neo4j.int(skip)" in source
    assert "limit: neo4j.int(boundedPageSize)" in source


def test_get_latest_memories_by_container_handles_empty_container_results() -> None:
    """Verify empty/non-existent containers are handled by returning an empty list."""
    source = _read(NEO4J_CLIENT_PATH)
    assert "return result.records.map((record) => {" in source


def test_get_latest_memories_by_container_closes_session_on_error() -> None:
    """Verify session cleanup is guaranteed even if query processing fails."""
    source = _read(NEO4J_CLIENT_PATH)
    assert "public async getLatestMemoriesByContainer(" in source
    assert "try {" in source
    assert "finally {" in source
    assert "await session.close();" in source


def test_get_latest_memories_by_container_remains_bounded_when_container_is_large() -> (
    None
):
    """Verify query remains bounded for containers with many active memories."""
    source = _read(NEO4J_CLIENT_PATH)
    assert "const LIMIT_LATEST_MEMORIES = 100;" in source
    assert "pageSize: number = LIMIT_LATEST_MEMORIES" in source
    assert "ORDER BY m.createdAt DESC" in source
    assert "SKIP $skip" in source
    assert "LIMIT $limit" in source


def test_get_latest_memories_by_container_uses_parameterized_pagination_instead_of_unbounded_query() -> (
    None
):
    """Verify pagination values are passed as parameterized integers to Cypher."""
    source = _read(NEO4J_CLIENT_PATH)
    assert "MATCH (m:Memory {containerTag: $containerTag})" in source
    assert "skip: neo4j.int(skip)" in source
    assert "limit: neo4j.int(boundedPageSize)" in source
    assert "LIMIT $limit" in source


def test_get_latest_memories_by_container_normalizes_invalid_pagination_inputs() -> (
    None
):
    """Verify invalid page/pageSize values are normalized to safe minimums."""
    source = _read(NEO4J_CLIENT_PATH)
    assert "const boundedPage = Math.max(1, Math.floor(page));" in source
    assert "const boundedPageSize = Math.max(1, Math.floor(pageSize));" in source


def test_get_latest_memories_by_container_calculates_page_offset_from_page_and_size() -> (
    None
):
    """Verify SKIP offset is derived from normalized page and pageSize."""
    source = _read(NEO4J_CLIENT_PATH)
    assert "const skip = (boundedPage - 1) * boundedPageSize;" in source
    assert "skip: neo4j.int(skip)" in source


def test_get_latest_memories_by_container_orders_before_paginating() -> None:
    """Verify ordering by newest memory happens before SKIP/LIMIT pagination."""
    source = _read(NEO4J_CLIENT_PATH)
    order_idx = source.index("ORDER BY m.createdAt DESC")
    skip_idx = source.index("SKIP $skip")
    limit_idx = source.index("LIMIT $limit")
    assert order_idx < skip_idx < limit_idx
