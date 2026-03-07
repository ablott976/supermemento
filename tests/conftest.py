"""Test configuration and fixtures."""
import sys
from unittest.mock import AsyncMock

import pytest

# Add app to path if needed
sys.path.insert(0, str(__import__('pathlib').Path(__file__).parent.parent))


@pytest.fixture
def mock_neo4j_driver():
    """Create a mock Neo4j driver for testing."""
    mock_driver = AsyncMock()
    mock_session = AsyncMock()
    mock_driver.session.return_value.__aenter__.return_value = mock_session
    mock_driver.session.return_value.__aexit__.return_value = None
    return mock_driver, mock_session


@pytest.fixture
def sample_memory_data():
    """Sample memory data without embedding (as per optimization)."""
    return {
        "id": "mem-123",
        "content": "Test memory content",
        "memoryType": "observation",
        "containerTag": "test-container",
        "isLatest": True,
        "confidence": 0.95,
        "originalConfidence": 0.95,
        "validFrom": "2024-01-01T00:00:00Z",
        "validTo": None,
        "forgottenAt": None,
        "createdAt": "2024-01-01T00:00:00Z",
        "sourceDocId": "doc-456",
    }


@pytest.fixture
def sample_document_data():
    """Sample document data without rawContent (as per optimization)."""
    return {
        "id": "doc-123",
        "title": "Test Document",
        "contentType": "text/plain",
        "sourceUrl": "http://example.com/doc",
        "filePath": "/docs/test.txt",
        "containerTag": "test-container",
        "metadata": {"author": "test"},
        "status": "processed",
        "createdAt": "2024-01-01T00:00:00Z",
        "updatedAt": "2024-01-01T00:00:00Z",
    }
