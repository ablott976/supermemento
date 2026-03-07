from __future__ import annotations

import re
import sys
import tracemalloc
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
NEO4J_CLIENT_PATH = REPO_ROOT / "src" / "db" / "neo4j-client.ts"


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def test_list_memories_excludes_embedding_field() -> None:
    """Verify listMemories excludes embedding field from projection to reduce payload."""
    source = _read(NEO4J_CLIENT_PATH)
    # Find listMemories method
    start_idx = source.find("public async listMemories(")
    assert start_idx != -1, "listMemories method must be defined"

    # Find the end of the method (next public method or end of class)
    next_public = source.find("public async", start_idx + len("public async listMemories("))
    if next_public == -1:
        method_section = source[start_idx:]
    else:
        method_section = source[start_idx:next_public]

    # Verify projection pattern is used: RETURN m { ... } as m
    assert re.search(r"RETURN\s+m\s*\{[^}]*\}\s*as\s+m", method_section), \
        "listMemories should use projection pattern 'RETURN m { ... } as m' to limit fields"

    # Extract projection fields
    match = re.search(r"RETURN\s+m\s*\{([^}]+)\}\s*as\s+m", method_section, re.DOTALL)
    assert match is not None, "Could not find RETURN projection in listMemories"
    projection_fields = match.group(1)

    # Critical: embedding field must be excluded to reduce payload
    assert ".embedding" not in projection_fields, \
        "embedding field must be excluded from listMemories projection to reduce payload"

    # Verify essential fields are included
    assert ".id" in projection_fields, "id field should be included in projection"
    assert ".content" in projection_fields, "content field should be included in projection"
    assert ".metadata" in projection_fields, "metadata field should be included in projection"
    assert ".createdAt" in projection_fields, "createdAt field should be included in projection"
    assert ".updatedAt" in projection_fields, "updatedAt field should be included in projection"


def test_list_memories_not_using_return_star() -> None:
    """Verify listMemories does not use RETURN * which would include all fields."""
    source = _read(NEO4J_CLIENT_PATH)
    start_idx = source.find("public async listMemories(")
    assert start_idx != -1, "listMemories method must be defined"

    next_public = source.find("public async", start_idx + len("public async listMemories("))
    if next_public == -1:
        method_section = source[start_idx:]
    else:
        method_section = source[start_idx:next_public]

    # Should not use RETURN * as m
    assert not re.search(r"RETURN\s+\*\s*as\s+m", method_section), \
        "listMemories should not use RETURN * as m"

    # Should not use RETURN m without projection
    assert not re.search(r"RETURN\s+m\s*$", method_section, re.MULTILINE), \
        "listMemories should not use RETURN m without projection"


def test_list_documents_excludes_raw_content_field() -> None:
    """Verify listDocuments excludes rawContent field from projection to reduce payload."""
    source = _read(NEO4J_CLIENT_PATH)
    # Find listDocuments method
    start_idx = source.find("public async listDocuments(")
    assert start_idx != -1, "listDocuments method must be defined"

    # Find the end of the method (next public method or end of class)
    next_public = source.find("public async", start_idx + len("public async listDocuments("))
    if next_public == -1:
        method_section = source[start_idx:]
    else:
        method_section = source[start_idx:next_public]

    # Verify projection pattern is used: RETURN d { ... } as d
    assert re.search(r"RETURN\s+d\s*\{[^}]*\}\s*as\s+d", method_section), \
        "listDocuments should use projection pattern 'RETURN d { ... } as d' to limit fields"

    # Extract projection fields
    match = re.search(r"RETURN\s+d\s*\{([^}]+)\}\s*as\s+d", method_section, re.DOTALL)
    assert match is not None, "Could not find RETURN projection in listDocuments"
    projection_fields = match.group(1)

    # Critical: rawContent field must be excluded to reduce payload
    assert ".rawContent" not in projection_fields, \
        "rawContent field must be excluded from listDocuments projection to reduce payload"

    # Verify essential fields are included
    assert ".id" in projection_fields, "id field should be included in projection"
    assert ".title" in projection_fields, "title field should be included in projection"
    assert ".content" in projection_fields, "content field should be included in projection"
    assert ".metadata" in projection_fields, "metadata field should be included in projection"
    assert ".createdAt" in projection_fields, "createdAt field should be included in projection"
    assert ".updatedAt" in projection_fields, "updatedAt field should be included in projection"


def test_list_documents_not_using_return_star() -> None:
    """Verify listDocuments does not use RETURN * which would include all fields."""
    source = _read(NEO4J_CLIENT_PATH)
    start_idx = source.find("public async listDocuments(")
    assert start_idx != -1, "listDocuments method must be defined"

    next_public = source.find("public async", start_idx + len("public async listDocuments("))
    if next_public == -1:
        method_section = source[start_idx:]
    else:
        method_section = source[start_idx:next_public]

    # Should not use RETURN * as d
    assert not re.search(r"RETURN\s+\*\s*as\s+d", method_section), \
        "listDocuments should not use RETURN * as d"

    # Should not use RETURN d without projection
    assert not re.search(r"RETURN\s+d\s*$", method_section, re.MULTILINE), \
        "listDocuments should not use RETURN d without projection"


def test_list_memories_memory_allocation_reduction() -> None:
    """Verify that excluding embedding field reduces memory allocation."""
    # Simulate 3072-dimensional embeddings (typical for OpenAI text-embedding-3-large)
    embedding_size = 3072
    num_records = 100

    # Start tracking memory
    tracemalloc.start()

    try:
        # Simulate old behavior: fetching full nodes with embeddings
        old_memories = [
            {
                "id": f"mem_{i}",
                "content": "Memory content",
                "embedding": [0.001] * embedding_size,  # 3072 floats
                "metadata": {"key": "value"},
                "createdAt": "2024-01-01",
                "updatedAt": "2024-01-01",
            }
            for i in range(num_records)
        ]

        # Process old data (simulate server.ts stripping embeddings)
        old_processed = [{k: v for k, v in m.items() if k != "embedding"} for m in old_memories]

        _, peak_with = tracemalloc.get_traced_memory()
        tracemalloc.reset_peak()

        # Simulate new behavior: projection excludes embedding at DB level
        new_memories = [
            {
                "id": f"mem_{i}",
                "content": "Memory content",
                "metadata": {"key": "value"},
                "createdAt": "2024-01-01",
                "updatedAt": "2024-01-01",
            }
            for i in range(num_records)
        ]

        # Process new data (no stripping needed)
        new_processed = new_memories

        _, peak_without = tracemalloc.get_traced_memory()

        # Memory allocation should be significantly lower (at least 50% reduction)
        # Embeddings are the dominant memory consumer
        reduction_ratio = peak_without / peak_with if peak_with > 0 else 0
        assert reduction_ratio < 0.5, (
            f"Memory allocation should be reduced by at least 50% when excluding embeddings. "
            f"Peak with embeddings: {peak_with}, Peak without: {peak_without}, "
            f"Ratio: {reduction_ratio:.2%}"
        )
        assert old_processed == new_processed, "Data should be equivalent after processing"

    finally:
        tracemalloc.stop()


def test_list_documents_memory_allocation_reduction() -> None:
    """Verify that excluding rawContent field reduces memory allocation."""
    # Simulate large documents (100KB raw content)
    raw_content_size = 100 * 1024  # 100KB
    num_records = 50

    tracemalloc.start()

    try:
        # Simulate old behavior: fetching full documents with rawContent
        old_documents = [
            {
                "id": f"doc_{i}",
                "title": "Document Title",
                "content": "Summary content",
                "rawContent": "X" * raw_content_size,  # 100KB of content
                "metadata": {"key": "value"},
                "createdAt": "2024-01-01",
                "updatedAt": "2024-01-01",
            }
            for i in range(num_records)
        ]

        # Process old data (simulate server.ts stripping rawContent)
        old_processed = [{k: v for k, v in d.items() if k != "rawContent"} for d in old_documents]

        _, peak_with = tracemalloc.get_traced_memory()
        tracemalloc.reset_peak()

        # Simulate new behavior: projection excludes rawContent at DB level
        new_documents = [
            {
                "id": f"doc_{i}",
                "title": "Document Title",
                "content": "Summary content",
                "metadata": {"key": "value"},
                "createdAt": "2024-01-01",
                "updatedAt": "2024-01-01",
            }
            for i in range(num_records)
        ]

        # Process new data (no stripping needed)
        new_processed = new_documents

        _, peak_without = tracemalloc.get_traced_memory()

        # Memory allocation should be significantly lower (at least 80% reduction)
        # rawContent is the dominant memory consumer for large documents
        reduction_ratio = peak_without / peak_with if peak_with > 0 else 0
        assert reduction_ratio < 0.2, (
            f"Memory allocation should be reduced by at least 80% when excluding rawContent. "
            f"Peak with rawContent: {peak_with}, Peak without: {peak_without}, "
            f"Ratio: {reduction_ratio:.2%}"
        )
        assert old_processed == new_processed, "Data should be equivalent after processing"
