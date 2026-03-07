import asyncio
import pytest
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

from src.services.connectors.web_crawler import WebCrawlerConnector
from src.services.ingestion.pipeline import IngestionPipeline
from src.db.neo4j_client import Neo4jClient
from src.types.enums import ContentType, DocumentStatus


@pytest.fixture
def mock_neo4j_client() -> MagicMock:
    """Mock Neo4j client."""
    return MagicMock(spec=Neo4jClient)


@pytest.fixture
def mock_ingestion_pipeline() -> MagicMock:
    """Mock ingestion pipeline."""
    pipeline = MagicMock(spec=IngestionPipeline)
    pipeline.ingest = AsyncMock()
    return pipeline


@pytest.fixture
def sample_urls() -> list[str]:
    """Sample URLs for testing."""
    return [
        "https://example.com/page1",
        "https://example.com/page2",
        "https://example.com/page3",
    ]


@pytest.fixture
def web_crawler(mock_neo4j_client: MagicMock, mock_ingestion_pipeline: MagicMock) -> WebCrawlerConnector:
    """Create WebCrawlerConnector instance with mocked dependencies."""
    return WebCrawlerConnector(
        neo4jClient=mock_neo4j_client,
        ingestionPipeline=mock_ingestion_pipeline,
        urls=["https://example.com"],
        containerTag="test-container"
    )


@pytest.mark.asyncio
async def test_fetch_returns_connector_documents(
    web_crawler: WebCrawlerConnector,
    sample_urls: list[str]
