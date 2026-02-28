import asyncio
import logging
import random
from typing import List, Optional

from openai import AsyncOpenAI

from app.config import settings

logger = logging.getLogger(__name__)


class EmbeddingService:
    """OpenAI Embedding Service wrapper for text-embedding-3-large.

    Supports batching up to 100 texts per request and includes exponential backoff
    retries with jitter for improved reliability under load.
    """

    MAX_BATCH_SIZE = 100  # OpenAI API limit for embeddings batch size

    def __init__(self, api_key: Optional[str] = None):
        """Initialize the embedding service with the OpenAI API key.

        Args:
            api_key: OpenAI API key. If not provided, uses settings.OPENAI_API_KEY.
        """
        self._api_key = api_key or settings.OPENAI_API_KEY
        self._client: Optional[AsyncOpenAI] = None
        self.model = settings.EMBEDDING_MODEL
        self.dimension = settings.EMBEDDING_DIMENSION
        self.max_retries = 3
        self.base_delay = 1.0  # Start with 1 second delay
        self.max_delay = 60.0  # Cap delay at 60 seconds

    @property
    def client(self) -> AsyncOpenAI:
        """Lazy initialization of the OpenAI client."""
        if self._client is None:
            if not self._api_key:
                raise ValueError(
                    "OpenAI API key is not set. Please set OPENAI_API_KEY in .env "
                    "or pass it to the constructor."
                )
            # Disable built-in retries since we handle them manually for better control
            self._client = AsyncOpenAI(api_key=self._api_key, max_retries=0)
        return self._client

    def _validate_texts(self, texts: List[str]) -> None:
        """Validate that all texts are non-empty strings.

        Args:
            texts: List of texts to validate.

        Raises:
            ValueError: If any text is empty or not a string.
        """
        for i, text in enumerate(texts):
            if not isinstance(text, str):
                raise ValueError(f"Text at index {i} is not a string")
            if not text.strip():
                raise ValueError(f"Text at index {i} is empty or whitespace-only")

    async def _embed_batch_with_retry(
        self, batch: List[str], batch_start_index: int = 0
    ) -> List[List[float]]:
        """Embed a batch of texts with exponential backoff retry logic.

        Implements exponential backoff with jitter to handle rate limits and
        transient failures. Enforces MAX_BATCH_SIZE limit of 100 texts.

        Args:
            batch: List of texts to embed (max 100 items).
            batch_start_index: Starting index of this batch for logging purposes.

        Returns:
            List of embedding vectors in the same order as input texts.

        Raises:
            ValueError: If batch size exceeds MAX_BATCH_SIZE (100).
            Exception: If all retry attempts fail.
        """
        if len(batch) > self.MAX_BATCH_SIZE:
            raise ValueError(
                f"Batch size {len(batch)} exceeds maximum of {self.MAX_BATCH_SIZE}"
            )

        # Validate texts before sending to API
        self._validate_texts(batch)

        last_exception: Optional[Exception] = None

        for attempt in range(self.max_retries):
            try:
                response = await self.client.embeddings.create(
                    input=batch,
                    model=self.model,
                    dimensions=self.dimension,
                )

                # Ensure results are in the correct order based on the index
                embeddings = [
                    data.embedding
                    for data in sorted(response.data, key=lambda x: x.index)
                ]
                return embeddings

            except Exception as e:
                last_exception = e
                if attempt < self.max_retries - 1:
                    # Exponential backoff: base_delay * 2^attempt
                    delay = min(self.base_delay * (2**attempt), self.max_delay)
                    # Add jitter (0-1 seconds) to prevent thundering herd
                    jitter = random.random()
                    wait_time = delay + jitter

                    logger.warning(
                        f"Embedding attempt {attempt + 1}/{self.max_retries} failed "
                        f"for batch starting at index {batch_start_index}. "
                        f"Retrying in {wait_time:.2f}s... Error: {e}"
                    )
                    await asyncio.sleep(wait_time)
                else:
                    logger.error(
                        f"Failed to get embeddings after {self.max_retries} attempts "
                        f"for batch starting at index {batch_start_index}: {e}"
                    )

        # If we get here, all retries failed
        if last_exception:
            raise last_exception
        raise RuntimeError("Embedding failed after all retries")

    async def embed(self, texts: List[str]) -> List[List[float]]:
        """Embed a list of texts using batching and retry logic.

        Splits large lists into batches of MAX_BATCH_SIZE and processes them
        with exponential backoff retry logic.

        Args:
            texts: List of texts to embed.

        Returns:
            List of embedding vectors in the same order as input texts.
        """
        if not texts:
            return []

        all_embeddings: List[List[float]] = []

        # Process in batches
        for i in range(0, len(texts), self.MAX_BATCH_SIZE):
            batch = texts[i : i + self.MAX_BATCH_SIZE]
            batch_embeddings = await self._embed_batch_with_retry(batch, i)
            all_embeddings.extend(batch_embeddings)

        return all_embeddings
