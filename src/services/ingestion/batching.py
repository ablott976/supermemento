"""Batching utilities for ingestion pipeline.

Provides concurrency-limited parallel execution and batch database operations
to optimize N+1 query patterns.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable, Sequence
from typing import TypeVar

T = TypeVar("T")
R = TypeVar("R")


async def gather_with_limit(
    items: Sequence[T],
    async_func: Callable[[T], asyncio.Future[R] | R],
    max_concurrency: int = 10,
) -> list[R]:
    """Execute async function over items with limited concurrency.
    
    Replaces sequential loops (for...await) with parallel execution
    while respecting resource constraints.
    
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
