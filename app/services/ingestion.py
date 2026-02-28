import uuid
from datetime import datetime
from typing import List
import tiktoken 
from app.services.embedding import EmbeddingService 
import logging
import asyncio 

logger = logging.getLogger(__name__)

# Initialize tiktoken encoding globally for performance.
# 'cl100k_base' is the encoding for models like gpt-4, gpt-3.5-turbo, text-embedding-3-large, etc.
try:
    encoding = tiktoken.get_encoding("cl100k_base")
except ValueError:
    print("Warning: tiktoken encoding 'cl100k_base' not found. Token counting might be inaccurate.")
    encoding = None 

# Import Document and Chunk models from app.models.neo4j
# Remove local definitions as they are now imported.
try:
    from app.models.neo4j import Document, Chunk
except ImportError as e:
    logger.error(f"Failed to import Document and Chunk from app.models.neo4j: {e}")
    raise e

# Updated token counting function using tiktoken
def count_tokens(text: str) -> int:
    """
    Counts tokens in a given text using tiktoken's cl100k_base encoding.
    """
    if encoding is None:
        return len(text.split()) 
    return len(encoding.encode(text))

# Example strategy for text chunking (semantic, 512-1024 tokens)
def chunk_text_semantically(document: Document, max_tokens: int = 1024, min_tokens: int = 512) -> List[Chunk]:
    chunks: List[Chunk] = []
    current_chunk_content: List[str] = []
    current_token_count = 0
    chunk_index_counter = 0

    paragraphs = document.raw_content.split('\n\n') 

    for paragraph in paragraphs:
        if not paragraph.strip():
            continue
        paragraph_tokens = count_tokens(paragraph)

        if current_chunk_content and (current_token_count + paragraph_tokens > max_tokens):
            chunk_content = "\n\n".join(current_chunk_content) 
            chunk_token_count = count_tokens(chunk_content)
            chunks.append(Chunk( 
                id=uuid.uuid4(),
                content=chunk_content,
                token_count=chunk_token_count,
                chunk_index=chunk_index_counter,
                container_tag=document.container_tag,
                metadata={"original_paragraphs": len(current_chunk_content)}, 
                source_doc_id=document.id,
                created_at=datetime.utcnow()
            ))
            chunk_index_counter += 1
            current_chunk_content = [paragraph]
            current_token_count = paragraph_tokens
        else:
            current_chunk_content.append(paragraph)
            current_token_count += paragraph_tokens

    if current_chunk_content:
        chunk_content = "\n\n".join(current_chunk_content) 
        chunk_token_count = count_tokens(chunk_content)
        chunks.append(Chunk( 
            id=uuid.uuid4(),
            content=chunk_content,
            token_count=chunk_token_count,
            chunk_index=chunk_index_counter,
            container_tag=document.container_tag,
            metadata={"original_paragraphs": len(current_chunk_content)},
            source_doc_id=document.id,
            created_at=datetime.utcnow()
        ))

    return chunks

# Example strategy for conversation chunking (by turn)
def chunk_conversation_by_turn(document: Document) -> List[Chunk]:
    chunks: List[Chunk] = []
    turns = document.raw_content.split('\n') 

    for i, turn in enumerate(turns):
        if not turn.strip(): 
            continue
        token_count = count_tokens(turn)
        chunks.append(Chunk( 
            id=uuid.uuid4(),
            content=turn,
            token_count=token_count,
            chunk_index=i,
            container_tag=document.container_tag,
            metadata={"turn_index": i}, 
            source_doc_id=document.id,
            created_at=datetime.utcnow()
        ))
    return chunks

async def process_document_chunking(document: Document) -> List[Chunk]:
    """
    Orchestrates the document chunking process based on its content type.
    Updates document status to 'chunking' and then 'embedding' or 'error'.
    """
    print(f"Starting chunking for document ID: {document.id} with content type: {document.content_type}") 
    
    chunking_strategies = {
        "text": chunk_text_semantically,
        "conversation": chunk_conversation_by_turn,
    }

    strategy = chunking_strategies.get(document.content_type)

    if not strategy:
        print(f"Unsupported content type for chunking: {document.content_type}") 
        return [] 

    try:
        if asyncio.iscoroutinefunction(strategy):
            chunks = await strategy(document)
        else:
            chunks = strategy(document)
            
        print(f"Generated {len(chunks)} chunks for document ID: {document.id}") 
        
        # ADDED: Call generate_chunk_embeddings after chunking
        if chunks: # Only call if there are chunks to process
            processed_chunks = await generate_chunk_embeddings(chunks)
            return processed_chunks
        else:
            return [] # Return empty list if no chunks were generated

    except Exception as e:
        print(f"Error during chunking for document ID {document.id}: {e}") 
        raise e 

async def generate_chunk_embeddings(chunks: List[Chunk]) -> List[Chunk]:
    """
    Generates embeddings for a list of chunks using the EmbeddingService.
    """
    if not chunks:
        return []

    embedding_service = EmbeddingService() 
    
    chunk_contents = [chunk.content for chunk in chunks]
    
    try:
        embeddings = await embedding_service.embed(chunk_contents)
    except Exception as e:
        logger.error(f"Failed to generate embeddings for {len(chunks)} chunks: {e}")
        raise e 

    updated_chunks: List[Chunk] = []
    for i, chunk in enumerate(chunks):
        if i < len(embeddings): 
            chunk.embedding = embeddings[i] 
            updated_chunks.append(chunk)
        else:
            logger.warning(f"Missing embedding for chunk {chunk.id}. Expected {len(embeddings)} but got {len(chunk_contents)}.")

    return updated_chunks

async def main():
    text_doc = Document( 
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
    
    conversation_doc = Document( 
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

    unsupported_doc = Document( 
        id=uuid.uuid4(),
        title="Unsupported Document",
        source_url=None,
        content_type="image", 
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
