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


def test_get_latest_memories_by_container_has_limit_parameter() -> None:
    """Verify getLatestMemoriesByContainer accepts limit parameter with correct default."""
    source = _read(NEO4J_CLIENT_PATH)
    assert "public async getLatestMemoriesByContainer(" in source
    assert "limit: number = LIMIT_LATEST_MEMORIES" in source


def test_get_latest_memories_by_container_uses_limit_in_cypher() -> None:
    """Verify the Cypher query uses the limit parameter."""
    source = _read(NEO4J_CLIENT_PATH)
    assert "LIMIT $limit" in source


def test_get_latest_memories_by_container_passes_limit_to_session() -> None:
    """Verify the limit value is passed to session.run parameters."""
    source = _read(NEO4J_CLIENT_PATH)
    assert "{ containerTag, limit:" in source or "{containerTag, limit:" in source
