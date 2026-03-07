"""Tests for the core service module."""

from unittest.mock import Mock, patch

import pytest
import requests

from app.core.service import DataItem, DataService


class TestDataService:
    """Test suite for DataService."""
    
    @pytest.fixture
    def service(self) -> DataService:
        """Create service instance for testing."""
        return DataService("https://api.example.com")
    
    @pytest.fixture
    def mock_item(self) -> DataItem:
        """Create sample data item."""
        return DataItem(id=1, name="Test Item", value=10.5)
    
    def test_init_sets_api_url(self, service: DataService) -> None:
        """Test that initialization sets the API URL correctly."""
        assert service.api_url == "https://api.example.com"
        assert service._cache == {}
    
    def test_fetch_item_from_cache(
        self, 
        service: DataService, 
        mock_item: DataItem,
    ) -> None:
        """Test fetching item from cache."""
        service._cache[1] = mock_item
        result = service.fetch_item(1)
        assert result == mock_item
    
    @patch("app.core.service.requests.get")
    def test_fetch_item_from_api(
        self, 
        mock_get: Mock, 
        service: DataService,
    ) -> None:
        """Test fetching item from API."""
        mock_response = Mock()
        mock_response.json.return_value = {
            "id": 1,
            "name": "Test Item",
            "value": 10.5,
        }
        mock_response.raise_for_status.return_value = None
        mock_get.return_value = mock_response
        
        result = service.fetch_item(1)
        assert result.id == 1
        assert result.name == "Test Item"
        assert result.value == 10.5
        mock_get.assert_called_once_with(
            "https://api.example.com/items/1",
            timeout=30,
        )
    
    @patch("app.core.service.requests.get")
    def test_fetch_item_api_error(
        self, 
        mock_get: Mock, 
        service: DataService,
    ) -> None:
        """Test handling of API errors."""
        mock_get.side_effect = requests.HTTPError("404")
        
        with pytest.raises(ConnectionError):
            service.fetch_item(1)
    
    @patch("app.core.service.requests.get")
    def test_fetch_item_timeout(
        self, 
        mock_get: Mock, 
        service: DataService,
    ) -> None:
        """Test handling of timeout errors."""
        mock_get.side_effect = requests.Timeout()
        
        with pytest.raises(ConnectionError):
            service.fetch_item(1)
    
    @patch("app.core.service.requests.get")
    def test_fetch_item_validation_error(
        self, 
        mock_get: Mock, 
        service: DataService,
    ) -> None:
        """Test handling of validation errors."""
        mock_response = Mock()
        mock_response.json.return_value = {"invalid": "data"}
        mock_response.raise_for_status.return_value = None
        mock_get.return_value = mock_response
        
        with pytest.raises(ValueError):
            service.fetch_item(1)
    
    def test_process_items_empty_list(self, service: DataService) -> None:
        """Test processing empty list."""
        result = service.process_items([])
        assert result == {"count": 0, "total": 0.0, "average": 0.0}
    
    def test_process_items_with_values(self, service: DataService) -> None:
        """Test processing items with values."""
        items = [
            DataItem(id=1, name="A", value=10.0),
            DataItem(id=2, name="B", value=20.0),
            DataItem(id=3, name="C", value=None),
        ]
        result = service.process_items(items)
        assert result["count"] == 2
        assert result["total"] == 30.0
        assert result["average"] == 15.0
    
    def test_process_items_no_values(self, service: DataService) -> None:
        """Test processing items without values."""
        items = [
            DataItem(id=1, name="A", value=None),
            DataItem(id=2, name="B"),
        ]
        result = service.process_items(items)
        assert result["count"] == 0
        assert result["total"] == 0.0
        assert result["average"] == 0.0
