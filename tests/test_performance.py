from __future__ import annotations

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
NEO4J_CLIENT_PATH = REPO_ROOT / "src" / "db" / "neo4j-client.ts"


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


class TestBandwidthOptimizations:
    """Performance tests verifying bandwidth usage reductions through field projections."""

    def test_list_memories_excludes_embedding_to_reduce_payload(self) -> None:
        """Verify listMemories excludes embedding field to minimize bandwidth usage."""
        source = _read(NEO4J_CLIENT_PATH)

        assert "public async listMemories(" in source, "listMemories method must exist"

        start_idx = source.find("public async listMemories(")
        next_idx = source.find("public async", start_idx + len("public async listMemories("))
        method_section = source[start_idx:next_idx] if next_idx != -1 else source[start_idx:]

        # Verify projection is used to limit returned fields
        assert re.search(r"RETURN\s+m\s*\{", method_section), "Must use projection pattern 'RETURN m {...}'"

        # Extract projection fields
        match = re.search(r"RETURN\s+m\s*\{([^}]+)\}\s*as\s+m", method_section, re.DOTALL)
        assert match is not None, "Could not find projection fields"
        fields = match.group(1)

        # Critical: embedding is large (vector data) and should be excluded from list operations
        assert ".embedding" not in fields, "embedding field must be excluded to reduce bandwidth"
        assert ".id" in fields, "id should be included"
        assert ".content" in fields, "content should be included"

    def test_list_documents_excludes_raw_content_to_reduce_payload(self) -> None:
        """Verify listDocuments excludes rawContent field to minimize bandwidth usage."""
        source = _read(NEO4J_CLIENT_PATH)

        assert "public async listDocuments(" in source, "listDocuments method must exist"

        start_idx = source.find("public async listDocuments(")
        next_idx = source.find("public async", start_idx + len("public async listDocuments("))
        method_section = source[start_idx:next_idx] if next_idx != -1 else source[start_idx:]

        # Verify projection is used to limit returned fields
        assert re.search(r"RETURN\s+d\s*\{", method_section), "Must use projection pattern 'RETURN d {...}'"

        # Extract projection fields
        match = re.search(r"RETURN\s+d\s*\{([^}]+)\}\s*as\s+d", method_section, re.DOTALL)
        assert match is not None, "Could not find projection fields"
        fields = match.group(1)

        # Critical: rawContent can be large and should be excluded from list operations
        assert ".rawContent" not in fields, "rawContent field must be excluded to reduce bandwidth"
        assert ".id" in fields, "id should be included"
        assert ".title" in fields, "title should be included"

    def test_list_memories_uses_map_memory_for_consistent_mapping(self) -> None:
        """Verify listMemories uses mapMemory for consistent result processing."""
        source = _read(NEO4J_CLIENT_PATH)

        start_idx = source.find("public async listMemories(")
        assert start_idx != -1, "listMemories method must be defined"

        next_idx = source.find("public async", start_idx + len("public async listMemories("))
        method_section = source[start_idx:next_idx] if next_idx != -1 else source[start_idx:]

        assert "this.mapMemory(" in method_section, "listMemories should use this.mapMemory() for result mapping"

    def test_list_documents_uses_map_document_for_consistent_mapping(self) -> None:
        """Verify listDocuments uses mapDocument for consistent result processing."""
        source = _read(NEO4J_CLIENT_PATH)

        start_idx = source.find("public async listDocuments(")
        assert start_idx != -1, "listDocuments method must be defined"

        next_idx = source.find("public async", start_idx + len("public async listDocuments("))
        method_section = source[start_idx:next_idx] if next_idx != -1 else source[start_idx:]

        assert "this.mapDocument(" in method_section, "listDocuments should use this.mapDocument() for result mapping"

    def test_projection_pattern_reduces_network_payload(self) -> None:
        """Verify that both list methods use field projections to reduce network payload size."""
        source = _read(NEO4J_CLIENT_PATH)

        # Verify listMemories uses projection
        list_memories_start = source.find("public async listMemories(")
        next_public = source.find("public async", list_memories_start + len("public async listMemories("))
        memories_section = source[list_memories_start:next_public] if next_public != -1 else source[list_memories_start:]

        assert "RETURN m {" in memories_section or "RETURN m{" in memories_section, \
            "listMemories should use RETURN m {...} projection to limit bandwidth"

        # Verify listDocuments uses projection
        list_docs_start = source.find("public async listDocuments(")
        next_public = source.find("public async", list_docs_start + len("public async listDocuments("))
        docs_section = source[list_docs_start:next_public] if next_public != -1 else source[list_docs_start:]

        assert "RETURN d {" in docs_section or "RETURN d{" in docs_section, \
            "listDocuments should use RETURN d {...} projection to limit bandwidth"
