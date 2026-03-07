from __future__ import annotations

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
NEO4J_CLIENT_PATH = REPO_ROOT / "src" / "db" / "neo4j-client.ts"


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def test_list_memories_excludes_embedding_field() -> None:
    """Verify listMemories returns expected Memory fields without embedding to reduce payload size."""
    source = _read(NEO4J_CLIENT_PATH)

    # Verify method exists with correct signature
    assert "public async listMemories(" in source, "listMemories method must be defined"
    assert "Promise<Memory[]>" in source, "listMemories must return Promise<Memory[]>"

    # Extract the listMemories method implementation
    start_idx = source.find("public async listMemories(")
    assert start_idx != -1, "Could not find listMemories method"

    # Find the end of the method (next public method or end of class)
    next_public = source.find("public async", start_idx + len("public async listMemories("))
    if next_public == -1:
        method_section = source[start_idx:]
    else:
        method_section = source[start_idx:next_public]

    # Verify the method uses a Cypher projection to limit returned fields
    assert "RETURN m {" in method_section or "RETURN m{" in method_section, \
        "listMemories should use projection pattern 'RETURN m { ... }' to limit fields"

    # Extract and verify the projection excludes embedding
    match = re.search(r"RETURN\s+m\s*\{([^}]+)\}\s*as\s+m", method_section, re.DOTALL)
    assert match is not None, "Could not find RETURN projection in listMemories"

    projection_fields = match.group(1)

    # Critical: verify embedding is excluded
    assert ".embedding" not in projection_fields, \
        "embedding field must be excluded from listMemories projection to reduce payload"

    # Verify expected fields are included (basic sanity check)
    assert ".id" in projection_fields, "id field should be included in projection"
    assert ".content" in projection_fields, "content field should be included in projection"

    # Verify it uses mapMemory for consistent result mapping
    assert "this.mapMemory(" in method_section, \
        "listMemories should use this.mapMemory() for result mapping"
