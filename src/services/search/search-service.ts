import asyncio
from typing import Optional, List, Dict, Any
from dataclasses import dataclass, field

from ...config import AppConfig
from ...db.neo4j_client import Neo4jClient
from ..embedding import EmbeddingService
from .query_rewriter import QueryRewriterService
from .reranker import CohereReranker, SimpleReranker, Reranker
from .types import SearchParams, SearchResponse, SearchResult, MemoryHit, ChunkHit


class SearchService:
    """SuperRAG search service with hybrid retrieval, rewriting, and reranking."""
    
    def __init__(
        self,
        config: AppConfig,
        neo4j_client: Neo4jClient,
        embedding_service: EmbeddingService
    ):
        self.neo4j_client = neo4j_client
        self.embedding_service = embedding_service
        self.query_rewriter = QueryRewriterService(config)
        self.fallback_reranker: Reranker = SimpleReranker()
        self.default_reranker: Reranker = (
            CohereReranker(config) if config.COHERE_API_KEY else self.fallback_reranker
        )
    
    async def search(self, params: SearchParams) -> SearchResponse:
        """Execute semantic search according to requested mode.
        
        Args:
            params: Search parameters including filters.
            
        Returns:
            SearchResponse with results.
            
        Raises:
            ValueError: If search query is empty.
        """
        mode = params.search_mode or "hybrid"
        limit = params.limit or 10
        min_score = params.min_similarity or 0.6
        query = params.query.strip()
        
        if not query:
            raise ValueError("Search query cannot be empty")
        
        # Rewrite query if requested
        rewritten_query = (
            await self.query_rewriter.rewrite(query) if params.rewrite_query else query
        )
        
        # Generate embedding for the (possibly rewritten) query
        embedding = await self.embedding_service.generate_embedding(rewritten_query)
        
        # Search memories unless in RAG-only mode
        memory_results: List[MemoryHit] = []
        if mode != "rag":
            memory_results = await self.neo4j_client.semantic_search_memories_advanced(
                embedding=embedding,
                container_tag=params.container_tag,
                min_score=min_score,
                limit=limit,
                is_latest_only=True,
                memory_types=params.memory_types,
                include_expired=params.include_expired or False
            )
        
        # Search chunks unless in memory-only mode
        chunk_results: List[ChunkHit] = []
        if mode != "memory":
            chunk_results = await self.neo4j_client.semantic_search_chunks(
                embedding=embedding,
                container_tag=params.container_tag,
                min_score=min_score,
                limit=limit
            )
        
        # Merge results
        merged: List[SearchResult] = [
            SearchResult(
                id=hit.memory.id,
                type="memory",
                score=hit.score,
                content=hit.memory.content,
                container_tag=hit.memory.container_tag,
                source_doc_id=hit.memory.source_doc_id,
                memory_type=hit.memory.memory_type
            )
            for hit in memory_results
        ] + [
            SearchResult(
                id=hit.chunk.id,
                type="chunk",
                score=hit.score,
                content=hit.chunk.content,
                container_tag=hit.chunk.container_tag,
                source_doc_id=hit.chunk.source_doc_id,
                chunk_index=hit.chunk.chunk_index,
                metadata=hit.chunk.metadata
            )
            for hit in chunk_results
        ]
        
        # Deduplicate results
        deduped = self._dedupe(merged)
        
        # Rerank results
        reranker = self.default_reranker if params.rerank else self.fallback_reranker
        ranked = await reranker.rerank(query, deduped)
        
        return SearchResponse(
            query=query,
            rewritten_query=rewritten_query if params.rewrite_query else None,
            results=ranked[:limit]
        )
    
    def _dedupe(self, results: List[SearchResult]) -> List[SearchResult]:
        """Remove duplicate results keeping highest score."""
        by_id: Dict[str, SearchResult] = {}
        for result in results:
            key = f"{result.type}:{result.id}"
            existing = by_id.get(key)
            if not existing or result.score > existing.score:
                by_id[key] = result
        return sorted(by_id.values(), key=lambda x: x.score, reverse=True)
