"""Tests for WebCrawlerConnector TypeScript implementation.

Validates that src/services/connectors/web-crawler.ts maintains the expected
API after removing the orphaned crawl() method (GitHub Issue #29).
"""
from pathlib import Path
import re

import pytest

CONNECTOR_PATH = Path("src/services/connectors/web-crawler.ts")


class TestWebCrawlerConnector:
    """Test suite for WebCrawlerConnector."""

    @pytest.fixture(scope="class")
    def connector_source(self) -> str:
        """Load TypeScript source file content."""
        if not CONNECTOR_PATH.exists():
            pytest.skip(f"Source file not found: {CONNECTOR_PATH}")
        return CONNECTOR_PATH.read_text(encoding="utf-8")

    def test_source_file_exists(self) -> None:
        """Verify WebCrawlerConnector TypeScript file exists."""
        assert CONNECTOR_PATH.exists(), f"File not found: {CONNECTOR_PATH}"

    def test_class_defined(self, connector_source: str) -> None:
        """Verify WebCrawlerConnector class is defined."""
        assert "class WebCrawlerConnector" in connector_source, "WebCrawlerConnector class not found"

    def test_crawl_method_removed(self, connector_source: str) -> None:
        """Verify orphaned crawl() method was removed (Issue #29)."""
        # Find all occurrences of crawl(
        for match in re.finditer(r'\bcrawl\s*\(', connector_source):
            start = match.start()
            end = match.end()
            # Check context to see if it's crawlUrl( or crawlUrls(
            context = connector_source[start:end+4]  # +4 captures "Url" or "Urls"
            if not (context.startswith("crawlUrl(") or context.startswith("crawlUrls(")):
                pytest.fail(f"Found orphaned crawl() method at position {start}: {context[:50]}")

    def test_crawl_url_method_exists(self, connector_source: str) -> None:
        """Verify crawlUrl method is present for tool integration."""
        assert "crawlUrl" in connector_source, "crawlUrl method not found"

    def test_crawl_urls_method_exists(self, connector_source: str) -> None:
        """Verify crawlUrls method is present for batch operations."""
        assert "crawlUrls" in connector_source, "crawlUrls method not found"

    @pytest.mark.skip(reason="TypeScript implementation detail")
    def test_crawl_url_signature(self) -> None:
        """Placeholder for crawlUrl signature validation."""

    @pytest.mark.skip(reason="TypeScript implementation detail")
    def test_crawl_urls_signature(self) -> None:
        """Placeholder for crawlUrls signature validation."""
