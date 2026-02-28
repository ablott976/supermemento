import logging
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from neo4j import AsyncDriver
from pydantic import BaseModel, Field

from app.db.queries import CREATE_CHUNK_NODE, LINK_CHUNK_TO_DOCUMENT

logger = logging.getLogger(__name__)


class ChunkMetadata(BaseModel):
    """Metadata for a document chunk."""
    index: int = Field(..., description="Sequential index of the chunk")
    start_char: int = Field(..., description="Starting character position in original document")
    end_char: int = Field(..., description="Ending character position in original document")
    char_count: int = Field(..., description="Number of characters in this chunk")


class TextChunk(BaseModel):
    """A chunk of text with metadata."""
    text: str = Field(..., description="The chunk text content")
    metadata: ChunkMetadata = Field(..., description="Chunk metadata")


class IngestionService:
    """Service for document ingestion operations including chunking and preprocessing.
    
    Designed to prepare documents for embedding with text-embedding-3-large, 
    respecting token limits and semantic boundaries.
    """
    
    # Approximate characters per token for English text with OpenAI tokenizers
    CHARS_PER_TOKEN = 4
    # text-embedding-3-large has 8191 token limit; we use conservative 2000 for semantic coherence
    DEFAULT_CHUNK_TOKENS = 500  # ~2000 chars
    DEFAULT_OVERLAP_TOKENS = 50  # ~200 chars
    MAX_CHUNK_TOKENS = 2000

    def __init__(
        self,
        default_chunk_tokens: int = DEFAULT_CHUNK_TOKENS,
        default_overlap_tokens: int = DEFAULT_OVERLAP_TOKENS,
        max_chunk_tokens: int = MAX_CHUNK_TOKENS
    ):
        """Initialize the ingestion service.
        
        Args:
            default_chunk_tokens: Target chunk size in tokens (approximate).
            default_overlap_tokens: Overlap between chunks in tokens (approximate).
            max_chunk_tokens: Maximum allowed chunk size in tokens.
        """
        self.default_chunk_size = default_chunk_tokens * self.CHARS_PER_TOKEN
        self.default_overlap = default_overlap_tokens * self.CHARS_PER_TOKEN
        self.max_chunk_size = max_chunk_tokens * self.CHARS_PER_TOKEN

    def chunk_document(
        self,
        text: str,
        chunk_size: Optional[int] = None,
        chunk_overlap: Optional[int] = None
    ) -> List[TextChunk]:
        """Split a document into overlapping chunks suitable for embedding.
        
        Implements recursive character splitting that respects semantic boundaries 
        (paragraphs, sentences) where possible. Falls back to word boundaries 
        if semantic boundaries cannot be found.
        
        Args:
            text: The document text to chunk.
            chunk_size: Target size of each chunk in characters. Defaults to ~500 tokens.
            chunk_overlap: Number of characters to overlap between chunks. Defaults to ~50 tokens.
            
        Returns:
            List of TextChunk objects containing the chunked text and metadata.
            
        Raises:
            ValueError: If text is empty, or if chunk parameters are invalid.
        """
        if not text or not text.strip():
            raise ValueError("Document text cannot be empty or whitespace-only")

        chunk_size = chunk_size or self.default_chunk_size
        chunk_overlap = chunk_overlap or self.default_overlap

        if chunk_size <= 0:
            raise ValueError("Chunk size must be positive")
        if chunk_overlap < 0:
            raise ValueError("Chunk overlap must be non-negative")
        if chunk_overlap >= chunk_size:
            raise ValueError("Chunk overlap must be less than chunk size")
        if chunk_size > self.max_chunk_size:
            logger.warning(
                f"Chunk size {chunk_size} exceeds recommended maximum {self.max_chunk_size} "
                f"({self.max_chunk_size // self.CHARS_PER_TOKEN} tokens)"
            )

        text = text.strip()
        
        # Single chunk if document fits within limit
        if len(text) <= chunk_size:
            return [TextChunk(
                text=text,
                metadata=ChunkMetadata(
                    index=0,
                    start_char=0,
                    end_char=len(text),
                    char_count=len(text)
                )
            )]

        chunks: List[TextChunk] = []
        start = 0
        index = 0
        
        while start < len(text):
            end = min(start + chunk_size, len(text))
            
            # Try to find semantic boundary if not at end of text
            if end < len(text):
                # Search window: last 20% of chunk for paragraph break
                search_start = start + int(chunk_size * 0.8)
                
                # Look for paragraph boundary first (highest priority)
                paragraph_pos = text.rfind('\n\n', search_start, end)
                if paragraph_pos != -1 and paragraph_pos > start:
                    end = paragraph_pos
                else:
                    # Look for sentence boundary (period followed by space or newline)
                    sentence_pos = text.rfind('. ', search_start, end)
                    if sentence_pos != -1 and sentence_pos > start:
                        end = sentence_pos + 1  # Include the period
                    else:
                        # Look for word boundary (space)
                        word_pos = text.rfind(' ', search_start, end)
                        if word_pos != -1 and word_pos > start:
                            end = word_pos
            
            chunk_text = text[start:end].strip()
            if chunk_text:
                chunks.append(TextChunk(
                    text=chunk_text,
                    metadata=ChunkMetadata(
                        index=index,
                        start_char=start,
                        end_char=end,
                        char_count=len(chunk_text)
                    )
                ))
                index += 1
            
            # Move start forward by chunk_size - overlap, but ensure we make progress
            start = end - chunk_overlap if end - chunk_overlap > start else end
            
            # Safety check to prevent infinite loops
            if start >= len(text):
                break

        return chunks

    async def create_chunk_nodes(
        self,
        document_id: str,
        text: str,
        driver: AsyncDriver,
        chunk_size: Optional[int] = None,
        chunk_overlap: Optional[int] = None
    ) -> List[TextChunk]:
        """Chunk a document and persist Chunk nodes to Neo4j.
        
        Uses the chunking algorithm to split text into chunks, then creates
        Chunk nodes linked to the specified Document node via HAS_CHUNK relationships.
        
        Args:
            document_id: The ID of the parent Document node.
            text: The document text to chunk.
            driver: Neo4j async driver instance.
            chunk_size: Optional custom chunk size in characters.
            chunk_overlap: Optional custom chunk overlap in characters.
            
        Returns:
            List of TextChunk objects representing the created chunks.
            
        Raises:
            ValueError: If text is empty or chunking parameters are invalid.
        """
        chunks = self.chunk_document(text, chunk_size, chunk_overlap)
        
        if not chunks:
            logger.warning(f"No chunks created for document {document_id}")
            return []

        async with driver.session() as session:
            for chunk in chunks:
                chunk_id = str(uuid.uuid4())
                created_at = datetime.now(timezone.utc).isoformat()
                
                # Create Chunk node
                await session.run(
                    CREATE_CHUNK_NODE,
                    {
                        "chunk_id": chunk_id,
                        "document_id": document_id,
                        "text": chunk.text,
                        "index": chunk.metadata.index,
                        "start_char": chunk.metadata.start_char,
                        "end_char": chunk.metadata.end_char,
                        "char_count": chunk.metadata.char_count,
                        "created_at": created_at
                    }
                )
                
                # Create relationship to Document
                await session.run(
                    LINK_CHUNK_TO_DOCUMENT,
                    {
                        "chunk_id": chunk_id,
                        "document_id": document_id
                    }
                )
        
        logger.info(f"Created {len(chunks)} chunks for document {document_id}")
        return chunks
