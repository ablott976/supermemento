"""Tests for WebCrawlerConnector TypeScript implementation.

Validates that src/services/connectors/web-crawler.ts maintains the expected
API after removing the orphaned crawl() method (GitHub Issue #29).
"""

from pathlib import Path

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
        import re

        # Find all occurrences of crawl( for match in re.finditer(r'\bcrawl\s*\(', connector_source):
        for match in re.finditer(r'\bcrawl\s*\(', connector_source):
            start = match.start()
            end = match.end()
            # Check context to see if it's crawlUrl( or crawlUrls(
            context = connector_source[start:end + 4]  # +4 captures "Url" or "Urls"
            if not (context.startswith("crawlUrl(") or context.startswith("crawlUrls(")):
                pytest.fail(f"Found orphaned crawl() method at position {start}: {context[:50]}")

    def test_crawl_url_method_exists(self, connector_source: str) -> None:
        """Verify crawlUrl method is present for tool integration."""
        assert "crawlUrl" in connector_source, "crawlUrl method not found"

    def test_crawl_urls_method_exists(self, connector_source: str) -> None:
        """Verify crawlUrls method is present for batch operations."""
        assert "crawlUrls" in connector_source, "crawlUrls method not found"


class TestCrawlUrlMethod:
    """Test suite specifically for crawlUrl method (Story 5/8)."""

    @pytest.fixture(scope="class")
    def connector_source(self) -> str:
        """Load TypeScript source file content."""
        if not CONNECTOR_PATH.exists():
            pytest.skip(f"Source file not found: {CONNECTOR_PATH}")
        return CONNECTOR_PATH.read_text(encoding="utf-8")

    def test_crawl_url_is_async_method(self, connector_source: str) -> None:
        """Verify crawlUrl is declared as async method."""
        import re

        pattern = r'public\s+async\s+crawlUrl'
        if not re.search(pattern, connector_source):
            pytest.fail("crawlUrl should be declared as 'public async crawlUrl'")

    def test_crawl_url_accepts_url_parameter(self, connector_source: str) -> None:
        """Verify crawlUrl accepts url: string parameter."""
        import re

        pattern = r'crawlUrl\s*\(\s*url:\s*string'
        if not re.search(pattern, connector_source):
            pytest.fail("crawlUrl should accept 'url: string' parameter")

    def test_crawl_url_accepts_container_tag_parameter(self, connector_source: str) -> None:
        """Verify crawlUrl accepts containerTag: string parameter."""
        import re

        pattern = r'crawlUrl\s*\([^)]*containerTag:\s*string'
        if not re.search(pattern, connector_source):
            pytest.fail("crawlUrl should accept 'containerTag: string' parameter")

    def test_crawl_url_returns_promise_with_status(self, connector_source: str) -> None:
        """Verify crawlUrl returns Promise with status field."""
        import re

        # Check for return type annotation with Promise
        pattern = r'crawlUrl\s*\([^)]*\)\s*:\s*Promise<\s*\{\s*status:'
        if not re.search(pattern, connector_source):
            pytest.fail("crawlUrl should return Promise with status field")

    def test_crawl_url_returns_ingested_or_skipped_union(self, connector_source: str) -> None:
        """Verify crawlUrl return type includes 'ingested' | 'skipped' union."""
        import re

        # Look for the union type in return type
        pattern = r'["\']ingested["\']\s*\|\s*["\']skipped["\']'
        if not re.search(pattern, connector_source):
            pytest.fail("crawlUrl return type should include 'ingested' | 'skipped' union")

    def test_crawl_url_delegates_to_crawl_urls(self, connector_source: str) -> None:
        """Verify crawlUrl implementation delegates to crawlUrls with url wrapped in array."""
        import re

        delegation_pattern = r'this\.crawlUrls\s*\(\s*\[\s*url\s*\]\s*,\s*containerTag\s*\)'
        if not re.search(delegation_pattern, connector_source):
            pytest.fail("crawlUrl should delegate to this.crawlUrls([url], containerTag)")

    def test_crawl_url_awaits_crawl_urls(self, connector_source: str) -> None:
        """Verify crawlUrl awaits the crawlUrls call."""
        import re

        pattern = r'await\s+this\.crawlUrls'
        if not re.search(pattern, connector_source):
            pytest.fail("crawlUrl should await this.crawlUrls()")

    def test_crawl_url_extracts_first_result(self, connector_source: str) -> None:
        """Verify crawlUrl extracts first result from batch results."""
        import re

        # Check for batch results access - could be destructured or direct access
        patterns = [
            r'batch\.results\[0\]',
            r'results\[0\]',
            r'const\s+\[\s*first\s*\]',
        ]
        if not any(re.search(p, connector_source) for p in patterns):
            pytest.fail("crawlUrl should extract first result from batch.results[0]")

    def test_crawl_url_handles_undefined_first_result(self, connector_source: str) -> None:
        """Verify crawlUrl checks if first result exists before accessing."""
        import re

        # Check for guard clause when first result is undefined
        patterns = [
            r'if\s*\(\s*!first\s*\)',
            r'if\s*\(\s*first\s*===\s*undefined\s*\)',
            r'if\s*\(\s*!batch\.results\.length',
        ]
        if not any(re.search(p, connector_source) for p in patterns):
            pytest.fail("crawlUrl should check if first result exists before accessing")

    def test_crawl_url_returns_status_from_first_result(self, connector_source: str) -> None:
        """Verify crawlUrl maps status from first result."""
        import re

        # Check for status mapping from first result
        pattern = r'first\.status'
        if not re.search(pattern, connector_source):
            pytest.fail("crawlUrl should map status from first result (first.status)")

    def test_crawl_url_returns_document_id_from_first_result(self, connector_source: str) -> None:
        """Verify crawlUrl maps documentId from first result."""
        import re

        # Check for documentId mapping
        pattern = r'first\.documentId'
        if not re.search(pattern, connector_source):
            pytest.fail("crawlUrl should map documentId from first result (first.documentId)")

    def test_crawl_url_return_object_structure(self, connector_source: str) -> None:
        """Verify crawlUrl returns object with status and optional documentId."""
        import re

        # Look for return statement with object
        pattern = r'return\s*\{\s*status:\s*first\.status\s*,\s*documentId:\s*first\.documentId'
        if not re.search(pattern, connector_source):
            pytest.fail("crawlUrl should return { status: first.status, documentId: first.documentId }")

    def test_crawl_url_does_not_call_crawl_directly(self, connector_source: str) -> None:
        """Verify crawlUrl does not call the removed crawl() method."""
        import re

        # Look for this.crawl( pattern (not crawlUrl or crawlUrls)
        pattern = r'this\.crawl\s*\('
        if re.search(pattern, connector_source):
            pytest.fail("crawlUrl should not call the removed crawl() method")

    def test_crawl_url_error_handling(self, connector_source: str) -> None:
        """Verify crawlUrl has error handling for crawlUrls failures."""
        import re

        # Check for try-catch block or error handling
        pattern = r'try\s*\{[\s\S]*?this\.crawlUrls'
        if not re.search(pattern, connector_source):
            pytest.fail("crawlUrl should have error handling around crawlUrls call")
