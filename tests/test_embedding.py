from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.services.embedding import EmbeddingService


@pytest.fixture
def service() -> EmbeddingService:
    """Create a service instance with a mock OpenAI client."""
    svc = EmbeddingService(api_key="test-key")
    svc._client = MagicMock()
    svc._client.embeddings = MagicMock()
    svc._client.embeddings.create = AsyncMock()
    return svc


def make_embedding_response(*items: tuple[int, list[float]]) -> SimpleNamespace:
    """Create an OpenAI-like embeddings response."""
    return SimpleNamespace(
        data=[
            SimpleNamespace(index=index, embedding=embedding)
            for index, embedding in items
        ]
    )


def test_client_requires_api_key(monkeypatch):
    """The client should fail fast when no API key is available."""
    monkeypatch.setattr("app.services.embedding.settings.OPENAI_API_KEY", None)
    service = EmbeddingService(api_key=None)

    with pytest.raises(ValueError, match="OpenAI API key is not set"):
        _ = service.client


def test_client_lazy_initialization(monkeypatch):
    """The OpenAI client should be created once with retries disabled."""
    mock_client = MagicMock()
    mock_async_openai = MagicMock(return_value=mock_client)
    monkeypatch.setattr("app.services.embedding.AsyncOpenAI", mock_async_openai)

    service = EmbeddingService(api_key="lazy-key")

    assert service.client is mock_client
    assert service.client is mock_client
    mock_async_openai.assert_called_once_with(api_key="lazy-key", max_retries=0)


@pytest.mark.asyncio
async def test_embed_returns_empty_list_for_empty_input(service: EmbeddingService):
    """Embedding an empty list should short-circuit without API calls."""
    assert await service.embed([]) == []
    service.client.embeddings.create.assert_not_called()


@pytest.mark.asyncio
async def test_embed_single_batch_calls_openai_with_expected_arguments(
    service: EmbeddingService,
):
    """Single-batch embedding should pass the configured model and dimensions."""
    service.client.embeddings.create.return_value = make_embedding_response(
        (0, [0.1, 0.2]),
        (1, [0.3, 0.4]),
    )

    result = await service.embed(["first text", "second text"])

    assert result == [[0.1, 0.2], [0.3, 0.4]]
    service.client.embeddings.create.assert_awaited_once_with(
        input=["first text", "second text"],
        model=service.model,
        dimensions=service.dimension,
    )


@pytest.mark.asyncio
async def test_embed_sorts_embeddings_by_response_index(service: EmbeddingService):
    """OpenAI responses should be reordered to match input order."""
    service.client.embeddings.create.return_value = make_embedding_response(
        (2, [0.3]),
        (0, [0.1]),
        (1, [0.2]),
    )

    result = await service._embed_batch_with_retry(["a", "b", "c"])

    assert result == [[0.1], [0.2], [0.3]]


@pytest.mark.asyncio
async def test_embed_splits_requests_into_batches_of_100(service: EmbeddingService):
    """Large requests should be sent as multiple OpenAI batches."""
    batch_sizes: list[int] = []

    async def fake_create(*, input, model, dimensions):
        assert model == service.model
        assert dimensions == service.dimension
        batch_sizes.append(len(input))
        return make_embedding_response(
            *[(index, [float(text.split("-")[1])]) for index, text in enumerate(input)]
        )

    service.client.embeddings.create.side_effect = fake_create
    texts = [f"text-{index}" for index in range(205)]

    result = await service.embed(texts)

    assert batch_sizes == [100, 100, 5]
    assert len(result) == 205
    assert result[0] == [0.0]
    assert result[100] == [100.0]
    assert result[204] == [204.0]


@pytest.mark.asyncio
async def test_embed_retries_with_exponential_backoff_before_succeeding(
    service: EmbeddingService, monkeypatch
):
    """Transient failures should retry with backoff and jitter."""
    sleep_delays: list[float] = []
    attempts = [
        RuntimeError("temporary-1"),
        RuntimeError("temporary-2"),
        make_embedding_response((0, [1.23])),
    ]

    async def fake_create(**_kwargs):
        outcome = attempts.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    async def fake_sleep(delay: float):
        sleep_delays.append(delay)

    monkeypatch.setattr("app.services.embedding.asyncio.sleep", fake_sleep)
    monkeypatch.setattr("app.services.embedding.random.random", lambda: 0.25)
    service.client.embeddings.create.side_effect = fake_create

    result = await service.embed(["retry me"])

    assert result == [[1.23]]
    assert sleep_delays == [1.25, 2.25]
    assert service.client.embeddings.create.await_count == 3


@pytest.mark.asyncio
async def test_embed_raises_last_exception_after_retry_exhaustion(
    service: EmbeddingService, monkeypatch
):
    """The last API exception should bubble up after all retries fail."""

    async def fake_sleep(_delay: float):
        return None

    monkeypatch.setattr("app.services.embedding.asyncio.sleep", fake_sleep)
    monkeypatch.setattr("app.services.embedding.random.random", lambda: 0.0)
    service.client.embeddings.create.side_effect = RuntimeError("still failing")

    with pytest.raises(RuntimeError, match="still failing"):
        await service.embed(["never works"])

    assert service.client.embeddings.create.await_count == service.max_retries


@pytest.mark.asyncio
async def test_embed_rejects_non_string_text(service: EmbeddingService):
    """Non-string payloads should fail validation before the API call."""
    with pytest.raises(ValueError, match="Text at index 1 is not a string"):
        await service.embed(["valid", 123])  # type: ignore[list-item]

    service.client.embeddings.create.assert_not_called()


@pytest.mark.asyncio
async def test_embed_rejects_empty_or_whitespace_text(service: EmbeddingService):
    """Whitespace-only texts should fail validation before the API call."""
    with pytest.raises(ValueError, match="Text at index 0 is empty or whitespace-only"):
        await service.embed(["   "])

    service.client.embeddings.create.assert_not_called()


@pytest.mark.asyncio
async def test_embed_batch_rejects_more_than_100_items(service: EmbeddingService):
    """A single batch cannot exceed the OpenAI embedding API limit."""
    with pytest.raises(ValueError, match="Batch size 101 exceeds maximum of 100"):
        await service._embed_batch_with_retry(["x"] * 101)

    service.client.embeddings.create.assert_not_called()
