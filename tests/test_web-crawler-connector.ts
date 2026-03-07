"""Tests for WebCrawlerConnector error handling."""

import pytest
from unittest.mock import Mock, patch
from src.services.connectors.web_crawler import WebCrawlerConnector
from src.db.neo4j_client import Neo4jClient
from src.services.ingestion.pipeline import IngestionPipeline


@pytest.fixture
def mock_neo4j_client():
    """Provide a mocked Neo4jClient."""
    return Mock(spec=Neo4jClient)


@pytest.fixture
def mock_ingestion_pipeline():
    """Provide a mocked IngestionPipeline."""
    return Mock(spec=IngestionPipeline)


@pytest.fixture
def connector(mock_neo4j_client, mock_ingestion_pipeline):
    """Provide a WebCrawlerConnector instance with mocked dependencies."""
    return WebCrawlerConnector(mock_neo4j_client, mock_ingestion_pipeline)


class TestWebCrawlerErrorCases:
    """Test HTTP error handling in WebCrawlerConnector."""

    def test_fetch_raises_on_404_not_found(self, connector):
        """Verify that 404 errors are properly raised."""
        with patch("requests.get") as mock_get:
            mock_response = Mock()
            mock_response.status_code = 404
            mock_response.raise_for_status.side_effect = Exception("404 Client Error: Not Found")
            mock_get.return_value = mock_response

            with pytest.raises(Exception, match="404"):
                connector.fetch("https://example.com/missing-page")

    def test_fetch_raises_on_400_bad_request(self, connector):
        """Verify that 400 errors are properly raised."""
        with patch("requests.get") as mock_get:
            mock_response = Mock()
            mock_response.status_code = 400
            mock_response.raise_for_status.side_effect = Exception("400 Client Error: Bad Request")
            mock_get.return_value = mock_response

            with pytest.raises(Exception, match="400"):
                connector.fetch("https://example.com/invalid-params")

    def test_fetch_raises_on_409_conflict(self, connector):
        """Verify that 409 errors are properly raised."""
        with patch("requests.get") as mock_get:
            mock_response = Mock()
            mock_response.status_code = 409
            mock_response.raise_for_status.side_effect = Exception("409 Client Error: Conflict")
            mock_get.return_value = mock_response

            with pytest.raises(Exception, match="409"):
                connector.fetch("https://example.com/conflicting-resource")

    def test_fetch_handles_network_errors(self, connector):
        """Verify that network-level errors are properly propagated."""
        with patch("requests.get") as mock_get:
            mock_get.side_effect = Exception("Network error: Connection refused")

            with pytest.raises(Exception, match="Network error"):
                connector.fetch("https://example.com/unreachable")

    def test_fetch_handles_timeout_errors(self, connector):
        """Verify that timeout errors are properly handled."""
        with patch("requests.get") as mock_get:
            mock_get.side_effect = Exception("Timeout error: Request timed out after 30s")

            with pytest.raises(Exception, match="Timeout"):
                connector.fetch("https://example.com/slow-endpoint")
