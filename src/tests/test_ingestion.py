import asyncio
import pytest
from datetime import datetime
from unittest.mock import AsyncMock, patch
from src.services.ingestion.processor import process_urls_parallel, URLProcessingResult
from src.types.models import Document
from src.types.enums import ContentType, DocumentStatus


@pytest.fixture
def mock_url_fetcher() -> AsyncMock:
    """Mock for URL fetching that returns content."""
    return AsyncMock()


@pytest.fixture
def sample_urls() -> list[str]:
    return [
        "https://example.com/doc1.pdf",
        "https://example.com/doc2.png",
        "https://example.com/doc3.txt",
    ]


@pytest.mark.asyncio
async def test_processes_urls_in_parallel(sample_urls: list[str]) -> None:
    """Test that URLs are processed concurrently, not sequentially."""
    processing_times: list[float] = []
    
    async def mock_process(url: str) -> URLProcessingResult:
        start = asyncio.get_event_loop().time()
        await asyncio.sleep(0.1)  # Simulate network delay
        processing_times.append(asyncio.get_event_loop().time() - start)
        return URLProcessingResult(
            url=url,
            success=True,
            document=Document(
                id=f"doc-{url}",
                title=f"Doc from {url}",
                content_type=ContentType.Pdf,
                raw_content="content",
                container_tag="test",
                metadata={},
                status=DocumentStatus.Processed,
                file_path=None,
            ),
            error=None,
        )
    
    with patch("src.services.ingestion.processor.process_single_url", side_effect=mock_process):
        start_time = asyncio.get_event_loop().time()
        results = await process_urls_parallel(sample_urls, max_concurrency=3)
        total_time = asyncio.get_event_loop().time() - start_time
    
    # If run sequentially, would take ~0.3s, in parallel should take ~0.1s
    assert total_time < 0.25  # Allow some overhead
    assert len(results) == 3
    assert all(r.success for r in results)


@pytest.mark.asyncio
async def test_handles_individual_url_failures_gracefully(sample_urls: list[str]) -> None:
    """Test that one failing URL doesn't stop processing of others."""
    async def mock_process(url: str) -> URLProcessingResult:
        if "doc2" in url:
            raise Exception("Network error")
        return URLProcessingResult(
            url=url,
            success=True,
            document=Document(
                id=f"doc-{url}",
                title=f"Doc from {url}",
                content_type=ContentType.Pdf,
                raw_content="content",
                container_tag="test",
                metadata={},
                status=DocumentStatus.Processed,
                file_path=None,
            ),
            error=None,
        )
    
    with patch("src.services.ingestion.processor.process_single_url", side_effect=mock_process):
        results = await process_urls_parallel(sample_urls, max_concurrency=3)
    
    assert len(results) == 3
    success_count = sum(1 for r in results if r.success)
    failure_count = sum(1 for r in results if not r.success)
    
    assert success_count == 2
    assert failure_count == 1
    
    # Check that the failure is recorded properly
    failure = [r for r in results if not r.success][0]
    assert "doc2" in failure.url
    assert failure.error is not None


@pytest.mark.asyncio
async def test_respects_max_concurrency_limit(sample_urls: list[str]) -> None:
    """Test that concurrency limit is respected."""
    active_count = 0
    max_active = 0
    lock = asyncio.Lock()
    
    async def mock_process(url: str) -> URLProcessingResult:
        nonlocal active_count, max_active
        async with lock:
            active_count += 1
            max_active = max(max_active, active_count)
        
        await asyncio.sleep(0.05)
        
        async with lock:
            active_count -= 1
        
        return URLProcessingResult(
            url=url,
            success=True,
            document=Document(
                id=f"doc-{url}",
                title=f"Doc from {url}",
                content_type=ContentType.Pdf,
                raw_content="content",
                container_tag="test",
                metadata={},
                status=DocumentStatus.Processed,
                file_path=None,
            ),
            error=None,
        )
    
    with patch("src.services.ingestion.processor.process_single_url", side_effect=mock_process):
        await process_urls_parallel(sample_urls, max_concurrency=2)
    
    assert max_active <= 2  # Should never exceed concurrency limit


@pytest.mark.asyncio
async def test_empty_url_list_returns_empty_results() -> None:
    """Test that empty input returns empty results without error."""
    results = await process_urls_parallel([])
    assert results == []


@pytest.mark.asyncio
async def test_creates_documents_with_correct_metadata(sample_urls: list[str]) -> None:
    """Test that processed documents have correct metadata attached."""
    expected_metadata = {"source": "batch_ingestion", "timestamp": datetime.now().isoformat()}
    
    async def mock_process(url: str) -> URLProcessingResult:
        return URLProcessingResult(
            url=url,
            success=True,
            document=Document(
                id=f"doc-{hash(url)}",
                title=f"Document from {url}",
                content_type=ContentType.Pdf,
                raw_content=f"Content from {url}",
                container_tag="batch",
                metadata=expected_metadata,
                status=DocumentStatus.Processed,
                file_path=None,
            ),
            error=None,
        )
    
    with patch("src.services.ingestion.processor.process_single_url", side_effect=mock_process):
        results = await process_urls_parallel(sample_urls[:1])
    
    assert len(results) == 1
    assert results[0].document.metadata == expected_metadata
    assert results[0].document.url == sample_urls[0]  # If URL is stored in metadata or specific field


@pytest.mark.asyncio
async def test_cancellation_stops_processing() -> None:
    """Test that cancellation interrupts parallel processing."""
    async def slow_process(url: str) -> URLProcessingResult:
        await asyncio.sleep(10)  # Very slow
        return URLProcessingResult(url=url, success=True, document=None, error=None)
    
    with patch("src.services.ingestion.processor.process_single_url", side_effect=slow_process):
        task = asyncio.create_task(
            process_urls_parallel(["http://slow1.com", "http://slow2.com"])
        )
        await asyncio.sleep(0.1)  # Let it start
        task.cancel()
        
        with pytest.raises(asyncio.CancelledError):
            await task
