import uuid
from datetime import datetime
from typing import List, Dict, Any, Optional
from pydantic import BaseModel
import tiktoken # Added import

# Initialize tiktoken encoding globally for performance.
# 'cl100k_base' is the encoding for models like gpt-4, gpt-3.5-turbo, text-embedding-3-large, etc.
try:
    encoding = tiktoken.get_encoding("cl100k_base")
except ValueError:
    print("Warning: tiktoken encoding 'cl100k_base' not found. Token counting might be inaccurate.")
    # As a fallback, define a dummy encoding or raise an error if tiktoken is critical.
    # For this context, let's assume it's available or the error will surface during testing.
    encoding = None # Placeholder if not available.

# Assuming these models exist based on the Neo4j Data Model Reference
# If they don't, they would need to be created first.
# For now, I'll define minimal Pydantic models here to make the code runnable.
# In a real scenario, these would likely be imported from app.models.document and app.models.chunk

class DocumentModel(BaseModel):
    id: uuid.UUID
    title: str
    source_url: Optional[str] = None
    content_type: str # enum: text/url/pdf/image/video/audio/conversation
    raw_content: str
    container_tag: str
    metadata: Dict[str, Any]
    status: str # enum: queued/extracting/chunking/embedding/indexing/done/error
    created_at: datetime
    updated_at: datetime

class ChunkModel(BaseModel):
    id: uuid.UUID
    content: str
    token_count: int
    chunk_index: int
    # embedding: Optional[List[float]] = None # Embeddings will be generated later
    container_tag: str
    metadata: Dict[str, Any]
    source_doc_id: uuid.UUID
    created_at: datetime

# Updated token counting function using tiktoken
def count_tokens(text: str) -> int:
    """
    Counts tokens in a given text using tiktoken's cl100k_base encoding.
    """
    if encoding is None:
        # Fallback if encoding failed to initialize. Highly inaccurate.
        return len(text.split()) 
    return len(encoding.encode(text))

# Example strategy for text chunking (semantic, 512-1024 tokens)
def chunk_text_semantically(document: DocumentModel, max_tokens: int = 1024, min_tokens: int = 512) -> List[ChunkModel]:
    """
    Chunks text semantically.
    A more advanced implementation would involve sentence splitting,
    grouping sentences based on topic coherence, and then splitting into token limits.
    For this placeholder, we'll do a simpler split based on paragraphs and token count.
    """
    chunks: List[ChunkModel] = []
    current_chunk_content: List[str] = []
    current_token_count = 0
    chunk_index_counter = 0

    # Split by paragraphs first as a basic semantic grouping
    paragraphs = document.raw_content.split('\n\n') # Corrected split

    for paragraph in paragraphs:
        # Ensure paragraph is not empty before counting tokens
        if not paragraph.strip():
            continue
        paragraph_tokens = count_tokens(paragraph)

        # If adding the paragraph exceeds max_tokens, finalize the current chunk
        # and start a new one with this paragraph.
        # Check if current_chunk_content is not empty AND if adding the new paragraph exceeds max_tokens.
        # If current_chunk_content is empty, we must add the paragraph even if it exceeds max_tokens
        # to avoid infinitely looping on a very large paragraph.
        if current_chunk_content and (current_token_count + paragraph_tokens > max_tokens):
            chunk_content = "\n\n".join(current_chunk_content) # Corrected join
            chunk_token_count = count_tokens(chunk_content)
            chunks.append(ChunkModel(
                id=uuid.uuid4(),
                content=chunk_content,
                token_count=chunk_token_count,
                chunk_index=chunk_index_counter,
                container_tag=document.container_tag,
                metadata={"original_paragraphs": len(current_chunk_content)}, # Example metadata
                source_doc_id=document.id,
                created_at=datetime.utcnow()
            ))
            chunk_index_counter += 1
            current_chunk_content = [paragraph]
            current_token_count = paragraph_tokens
        else:
            current_chunk_content.append(paragraph)
            current_token_count += paragraph_tokens

    # Add the last chunk if there's any remaining content
    if current_chunk_content:
        chunk_content = "\n\n".join(current_chunk_content) # Corrected join
        chunk_token_count = count_tokens(chunk_content)
        chunks.append(ChunkModel(
            id=uuid.uuid4(),
            content=chunk_content,
            token_count=chunk_token_count,
            chunk_index=chunk_index_counter,
            container_tag=document.container_tag,
            metadata={"original_paragraphs": len(current_chunk_content)},
            source_doc_id=document.id,
            created_at=datetime.utcnow()
        ))

    # Post-processing: If any chunk is smaller than min_tokens (and not the only chunk),
    # it might be merged with the next chunk. This is a complex optimization.
    # For simplicity, we'll skip complex merging for now and accept smaller chunks if they result.
    # A more robust approach would re-evaluate and merge chunks if they are significantly too small.

    return chunks

# Example strategy for conversation chunking (by turn)
def chunk_conversation_by_turn(document: DocumentModel) -> List[ChunkModel]:
    """
    Chunks conversation content by turns.
    Assumes conversation content is structured with clear turn indicators.
    """
    chunks: List[ChunkModel] = []
    # This is a placeholder. The actual parsing of turns would depend on the format
    # of document.raw_content for conversations.
    # Example: if content is "User: Hello\nAI: Hi there\nUser: How are you?",
    # we'd split based on "User:" or "AI:" prefixes.
    # For now, we'll just treat each line as a "turn" for simplicity.
    turns = document.raw_content.split('\n') # Corrected split

    for i, turn in enumerate(turns):
        if not turn.strip(): # Skip empty lines
            continue
        token_count = count_tokens(turn)
        chunks.append(ChunkModel(
            id=uuid.uuid4(),
            content=turn,
            token_count=token_count,
            chunk_index=i,
            container_tag=document.container_tag,
            metadata={"turn_index": i}, # Example metadata
            source_doc_id=document.id,
            created_at=datetime.utcnow()
        ))
    return chunks

    return chunks

async def process_document_chunking(document: DocumentModel) -> List[ChunkModel]:
    """
    Orchestrates the document chunking process based on its content type.
    Updates document status to 'chunking' and then 'embedding' or 'error'.
    """
    print(f"Starting chunking for document ID: {document.id} with content type: {document.content_type}") # Debugging
    
    # Update document status to 'chunking' if needed (depends on overall pipeline orchestration)
    # For this function, we focus solely on returning chunks.

    chunking_strategies = {
        "text": chunk_text_semantically,
        "conversation": chunk_conversation_by_turn,
        # Add other content types and their strategies here
        # e.g., "pdf": chunk_pdf_content, "url": chunk_web_content, etc.
    }

    strategy = chunking_strategies.get(document.content_type)

    if not strategy:
        # Handle unsupported content types - perhaps update document status to 'error'
        print(f"Unsupported content type for chunking: {document.content_type}") # Debugging
        # In a full pipeline, you would update the document status to 'error' here.
        # For this story, we just return an empty list or raise an error.
        return [] # Or raise ValueError(f"Unsupported content type: {document.content_type}")

    try:
        # Note: The strategy functions are currently synchronous.
        # Awaiting them allows for future asynchronous implementations of strategies.
        chunks = await strategy(document) 
        print(f"Generated {len(chunks)} chunks for document ID: {document.id}") # Debugging
        
        # In a full pipeline, after successful chunking, you would:
        # 1. Save these chunks to Neo4j (calling app/db/neo4j.py or similar)
        # 2. Update the document status to 'embedding'
        
        return chunks
    except Exception as e:
        print(f"Error during chunking for document ID {document.id}: {e}") # Debugging
        # In a full pipeline, you would update the document status to 'error' here.
        # raise e # Re-raise or handle as per pipeline error strategy
        return []

# Example of how this might be used (for testing purposes, not part of the final service file)
async def main():
    # Example Document: Text
    text_doc = DocumentModel(
        id=uuid.uuid4(),
        title="Example Text Document",
        source_url="http://example.com/doc1",
        content_type="text",
        raw_content="This is the first paragraph.\n\nThis is the second paragraph, which is a bit longer to test token limits. It contains multiple sentences.\n\nAnd this is the third paragraph. It's short.",
        container_tag="test_container",
        metadata={"original_format": "markdown"},
        status="queued",
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow()
    )
    
    # Example Document: Conversation
    conversation_doc = DocumentModel(
        id=uuid.uuid4(),
        title="Example Conversation",
        source_url=None,
        content_type="conversation",
        raw_content="User: Hello, how are you?\nAI: I'm doing well, thank you! How can I help you today?\nUser: I have a question about chunking.\nAI: Great! I can help with that. What's your question?",
        container_tag="test_container",
        metadata={"participants": ["User", "AI"]},
        status="queued",
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow()
    )

    print("--- Chunking Text Document ---")
    text_chunks = await process_document_chunking(text_doc)
    for i, chunk in enumerate(text_chunks):
        print(f"Text Chunk {i}: ID={chunk.id}, Tokens={chunk.token_count}, Content='{chunk.content[:50]}...'")

    print("\n--- Chunking Conversation Document ---")
    conversation_chunks = await process_document_chunking(conversation_doc)
    for i, chunk in enumerate(conversation_chunks):
        print(f"Conversation Chunk {i}: ID={chunk.id}, Tokens={chunk.token_count}, Content='{chunk.content[:50]}...'")

    # Example: Unsupported type
    unsupported_doc = DocumentModel(
        id=uuid.uuid4(),
        title="Unsupported Document",
        source_url=None,
        content_type="image", # Unsupported
        raw_content="dummy content",
        container_tag="test_container",
        metadata={},
        status="queued",
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow()
    )
    print("\n--- Chunking Unsupported Document ---")
    unsupported_chunks = await process_document_chunking(unsupported_doc)
    print(f"Result for unsupported type: {unsupported_chunks}")


if __name__ == "__main__":
    import asyncio
    asyncio.run(main())