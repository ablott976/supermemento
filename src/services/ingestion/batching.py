"""Batching utilities for ingestion pipeline.

Provides concurrency-limited parallel execution and batch database operations
to optimize N+1 query patterns.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import TypeVar, List, Optional
from uuid import uuid4

from src.db.neo4j_client import Neo4jClient
from src.types.enums import MemoryType

T = TypeVar("T")
R = TypeVar("R")


@dataclass
class MemoryBatchInput:
    """Input type for batch memory creation."""
    content: str
    memory_type: MemoryType
    container_tag: str
    confidence: float
    embedding: List[float]
    source_doc_id: str
    valid_from: Optional[str] = None
    valid_to: Optional[str] = None


async def gather_with_limit(
    items: Sequence[T],
    async_func: Callable[[T], asyncio.Future[R] | R],
    max_concurrency: int = 10,
) -> list[R]:
    """Execute async function over items with limited concurrency.

    Replaces sequential loops (for...await) with parallel execution while
    respecting resource constraints.

    Args:
        items: Items to process
        async_func: Async function to apply to each item
        max_concurrency: Maximum number of concurrent operations

    Returns:
        List of results in the same order as input items
    """
    semaphore = asyncio.Semaphore(max_concurrency)

    async def _wrap(item: T) -> R:
        async with semaphore:
            return await async_func(item)

    return await asyncio.gather(*[_wrap(item) for item in items])


def chunk_list(items: Sequence[T], chunk_size: int) -> list[list[T]]:
    """Split sequence into chunks of specified size.

    Args:
        items: Items to chunk
        chunk_size: Maximum size of each chunk

    Returns:
        List of chunks
    """
    if not items:
        return []
    return [
        list(items[i : i + chunk_size])
        for i in range(0, len(items), chunk_size)
    ]


async def process_batches(
    items: Sequence[T],
    batch_processor: Callable[[Sequence[T]], asyncio.Future[R] | R],
    batch_size: int = 100,
) -> list[R]:
    """Process items in batches.

    Useful for database batch operations (e.g., Neo4j UNWIND).

    Args:
        items: Items to process
        batch_processor: Async function that processes a batch of items
        batch_size: Size of each batch

    Returns:
        List of results from each batch
    """
    batches = chunk_list(items, batch_size)
    return await asyncio.gather(*[batch_processor(batch) for batch in batches])


async def batch_create_memories(
    neo4j_client: Neo4jClient,
    memories: Sequence[MemoryBatchInput],
) -> List[str]:
    """Batch create memories using Neo4j UNWIND for optimal performance.

    Creates multiple Memory nodes and their relationships to source documents
    in a single query.

    Args:
        neo4j_client: Neo4j client instance
        memories: Array of memory data to create

    Returns:
        Array of created memory IDs
    """
    if not memories:
        return []

    driver = neo4j_client.get_driver()
    session = driver.session()
    now = datetime.utcnow().isoformat()

    # Prepare data with generated IDs and timestamps
    memories_with_ids = [
        {
            "id": str(uuid4()),
            "content": memory.content,
            "memory_type": memory.memory_type.value,
            "container_tag": memory.container_tag,
            "confidence": memory.confidence,
            "embedding": memory.embedding,
            "source_doc_id": memory.source_doc_id,
            "valid_from": memory.valid_from,
            "valid_to": memory.valid_to,
            "created_at": now,
            "updated_at": now,
        }
        for memory in memories
    ]

    try:
        result = await session.run(
            """
            UNWIND $memories as memory
            CREATE (m:Memory {
                id: memory.id,
                content: memory.content,
                memoryType: memory.memory_type,
                containerTag: memory.container_tag,
                confidence: memory.confidence,
                embedding: memory.embedding,
                validFrom: CASE WHEN memory.valid_from IS NULL THEN NULL ELSE datetime(memory.valid_from) END,
                validTo: CASE WHEN memory.valid_to IS NULL THEN NULL ELSE datetime(memory.valid_to) END,
                isLatest: true,
                createdAt: datetime(memory.created_at),
                updatedAt: datetime(memory.updated_at)
            })
            WITH m, memory
            MATCH (d:Document {id: memory.source_doc_id})
            CREATE (m)-[:EXTRACTED_FROM]->(d)
            RETURN m.id as id
            """,
            {"memories": memories_with_ids},
        )
        
        records = await result.data()
        return [record["id"] for record in records]
    except Exception as e:
        # Ensure we don't lose the error context
        raise RuntimeError(f"Failed to batch create memories: {e}") from e
    finally:
        await session.close()
