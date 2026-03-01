import json
import logging
import re
from typing import List, Dict, Any
from uuid import uuid4
from datetime import datetime, timezone
from app.models.document import Document, ContentType
from app.services.embedding import EmbeddingService
from app.db.queries import CREATE_CHUNK, LINK_CHUNK_TO_DOCUMENT

logger = logging.getLogger(__name__)


class DocumentChunker:
    """Service to chunk documents based on their content type."""
    
    # Approximate character counts for 512-1024 tokens (1 token ~ 4 chars)
    MIN_CHUNK_CHARS = 2048
    MAX_CHUNK_CHARS = 4096
    
    def __init__(self, embedding_service: EmbeddingService):
        self.embedding_service = embedding_service
    
    def _chunk_text(self, text: str) -> List[str]:
        """Semantic chunking strategy for text (approx. 512-1024 tokens).
        
        Splits by paragraphs and merges them to fit the token limit.
        """
        paragraphs = [p.strip() for p in text.split("\n") if p.strip()]
        chunks = []
        current_chunk = ""
        
        for p in paragraphs:
            # If a single paragraph is larger than MAX, we must split it further
            if len(p) > self.MAX_CHUNK_CHARS:
                # If we have a pending chunk, save it
                if current_chunk:
                    chunks.append(current_chunk.strip())
                    current_chunk = ""
                
                # Split huge paragraph by sentences
                sentences = [s.strip() + "." for s in p.split(".") if s.strip()]
                for s in sentences:
                    if len(s) > self.MAX_CHUNK_CHARS:
                        # Even a single sentence is too long, split by character count
                        if current_chunk:
                            chunks.append(current_chunk.strip())
                            current_chunk = ""
                        for i in range(0, len(s), self.MAX_CHUNK_CHARS):
                            chunks.append(s[i : i + self.MAX_CHUNK_CHARS])
                    elif len(current_chunk) + len(s) + 1 <= self.MAX_CHUNK_CHARS:
                        current_chunk += s + " "
                    else:
                        if current_chunk:
                            chunks.append(current_chunk.strip())
                        current_chunk = s + " "
                continue
            
            if len(current_chunk) + len(p) + 2 <= self.MAX_CHUNK_CHARS:
                current_chunk += p + " "
            else:
                if current_chunk:
                    chunks.append(current_chunk.strip())
                current_chunk = p + " "
        
        if current_chunk:
            chunks.append(current_chunk.strip())
        
        return chunks
    
    def _chunk_conversation(self, text: str) -> List[str]:
        """Strategy for conversation: chunk by turn with intelligent grouping.
        
        Parses conversations in JSON format (OpenAI/Claude message format) or
        text format with speaker prefixes, groups consecutive turns while
        respecting MIN/MAX chunk size constraints.
        
        Supports formats:
        - JSON: [{"role": "user", "content": "..."}, {"role": "assistant", "content": "..."}]
        - JSON: ["message1", "message2"] (treated as alternating or unknown roles)
        - Text: "User: message\nAssistant: message" or similar speaker prefixes
        - Text: newline-separated turns (fallback)
        """
        messages = self._parse_conversation_messages(text)
        
        if not messages:
            return []
        
        chunks = []
        current_chunk = ""
        current_roles = set()
        
        for msg in messages:
            role = msg.get("role", "unknown")
            content = msg.get("content", "").strip()
            
            if not content:
                continue
            
            # Format with role prefix for context preservation
            formatted = f"{role.capitalize()}: {content}"
            
            # Handle oversized single messages
            if len(formatted) > self.MAX_CHUNK_CHARS:
                if current_chunk:
                    chunks.append(current_chunk.strip())
                    current_chunk = ""
                    current_roles.clear()
                
                # Split long message into chunks
                for i in range(0, len(formatted), self.MAX_CHUNK_CHARS):
                    chunks.append(formatted[i : i + self.MAX_CHUNK_CHARS])
                continue
            
            # Calculate if adding this message exceeds limits
            separator = "\n\n" if current_chunk else ""
            projected_len = len(current_chunk) + len(separator) + len(formatted)
            
            # Start new chunk if:
            # 1. Would exceed MAX_CHUNK_CHARS, OR
            # 2. Current chunk is above MIN and we're switching roles (natural boundary)
            role_changed = current_roles and role not in current_roles
            should_boundary = len(current_chunk) >= self.MIN_CHUNK_CHARS and role_changed
            
            if projected_len > self.MAX_CHUNK_CHARS or should_boundary:
                if current_chunk:
                    chunks.append(current_chunk.strip())
                current_chunk = formatted
                current_roles = {role}
            else:
                if current_chunk:
                    current_chunk += separator
                current_chunk += formatted
                current_roles.add(role)
        
        # Don't forget the last chunk
        if current_chunk:
            chunks.append(current_chunk.strip())
        
        return chunks
    
    def _parse_conversation_messages(self, text: str) -> List[Dict[str, str]]:
        """Parse conversation text into structured message format.
        
        Returns list of dicts with 'role' and 'content' keys.
        """
        # Try JSON parsing first (most structured)
        try:
            data = json.loads(text)
            if isinstance(data, list) and data:
                # Format: [{"role": "...", "content": "..."}]
                if isinstance(data[0], dict):
                    messages = []
                    for item in data:
                        if isinstance(item, dict):
                            role = item.get("role") or item.get("speaker") or "unknown"
                            content = item.get("content") or item.get("message") or item.get("text") or str(item)
                            messages.append({"role": str(role), "content": str(content)})
                    if messages:
                        return messages
                
                # Format: ["message1", "message2", ...] - treat as unknown role
                elif isinstance(data[0], str):
                    return [{"role": "unknown", "content": msg} for msg in data if msg.strip()]
        except (json.JSONDecodeError, TypeError):
            pass
        
        # Text parsing with speaker detection
        # Common patterns: "User:", "Assistant:", "Human:", "AI:", "Bot:", "System:"
        speaker_pattern = re.compile(
            r'^(?:User|Assistant|Human|AI|Bot|System|Speaker\s*\d*)\s*[:：]\s*',
            re.IGNORECASE | re.MULTILINE
        )
        
        lines = text.split('\n')
        messages = []
        current_content = []
        current_role = "unknown"
        
        for line in lines:
            line_stripped = line.strip()
            if not line_stripped:
                continue
            
            match = speaker_pattern.match(line_stripped)
            if match:
                # Save previous message if exists
                if current_content:
                    messages.append({
                        "role": current_role,
                        "content": " ".join(current_content)
                    })
                
                # Start new message
                current_role = match.group(0).rstrip(':： ').capitalize()
                content_start = match.end()
                current_content = [line_stripped[content_start:].strip()]
            else:
                current_content.append(line_stripped)
        
        # Save final message
        if current_content:
            messages.append({
                "role": current_role,
                "content": " ".join(current_content)
            })
        
        # If no speaker patterns found, treat each non-empty line as a turn
        if not messages:
            return [{"role": "unknown", "content": line.strip()} 
                    for line in lines if line.strip()]
        
        return messages
    
    def chunk_document_content(self, document: Document) -> List[str]:
        """Selects the chunking strategy based on content_type."""
        if document.content_type == ContentType.CONVERSATION:
            return self._chunk_conversation(document.raw_content)
        # Default strategy for text, url, pdf, etc.
        return self._chunk_text(document.raw_content)
    
    async def process_document(
        self,
        document: Document,
        neo4j_driver: Any
    ) -> List[Dict[str, Any]]:
        """Chunks a document, computes embeddings, and saves chunks to Neo4j.
        
        Returns the created chunks as a list of dictionaries.
        """
        # 1. Chunking
        text_chunks = self.chunk_document_content(document)
        if not text_chunks:
            logger.warning(f"No chunks generated for document {document.id}")
            return []
        
        # 2. Embedding
        embeddings = await self.embedding_service.embed(text_chunks)
        
        created_chunks = []
        
        # 3. Save to Neo4j
        async with neo4j_driver.session() as session:
            for idx, (content, embedding) in enumerate(zip(text_chunks, embeddings)):
                # Approximate token count (1 token ~ 4 chars)
                token_count = len(content) // 4
                chunk_id = uuid4()
                
                # Create the chunk record
                chunk_data = {
                    "id": str(chunk_id),
                    "content": content,
                    "token_count": token_count,
                    "embedding": embedding,
                    "index": idx,
                    "created_at": datetime.now(timezone.utc).isoformat()
                }
                
                # Create chunk node
                await session.run(
                    CREATE_CHUNK,
                    id=chunk_data["id"],
                    content=chunk_data["content"],
                    token_count=chunk_data["token_count"],
                    embedding=chunk_data["embedding"],
                    created_at=chunk_data["created_at"]
                )
                
                # Link chunk to document with ordering
                await session.run(
                    LINK_CHUNK_TO_DOCUMENT,
                    chunk_id=chunk_data["id"],
                    document_id=str(document.id),
                    index=idx
                )
                
                created_chunks.append(chunk_data)
        
        logger.info(f"Created {len(created_chunks)} chunks for document {document.id}")
        return created_chunks
