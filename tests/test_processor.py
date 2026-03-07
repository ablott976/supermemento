"""Tests for data processor module."""

import pytest

from app.processor import DataProcessor


class TestDataProcessor:
    """Test suite for DataProcessor."""
    
    def setup_method(self) -> None:
        """Create fresh processor for each test."""
        self.processor = DataProcessor()
    
    def teardown_method(self) -> None:
        """Clean up after each test."""
        self.processor.clear()
    
    def test_add_and_retrieve(self) -> None:
        """Test adding and retrieving valid items."""
        item = {"id": 1, "name": "test", "value": 42}
        self.processor.add_item(item)
        
        result = self.processor.get_by_id(1)
        assert result == item
        assert self.processor.count() == 1
    
    def test_get_nonexistent_returns_none(self) -> None:
        """Test that missing items return None."""
        result = self.processor.get_by_id(999)
        assert result is None
    
    def test_add_non_dict_raises_type_error(self) -> None:
        """Test type validation on add."""
        with pytest.raises(TypeError, match="must be a dictionary"):
            self.processor.add_item("not a dict")  # type: ignore[arg-type]
    
    def test_add_missing_id_raises_value_error(self) -> None:
        """Test ID validation on add."""
        with pytest.raises(ValueError, match="must contain 'id'"):
            self.processor.add_item({"name": "no id"})
    
    def test_clear_removes_all(self) -> None:
        """Test clear functionality."""
        self.processor.add_item({"id": 1})
        self.processor.add_item({"id": 2})
        
        self.processor.clear()
        
        assert self.processor.count() == 0
        assert self.processor.get_by_id(1) is None
        assert self.processor.get_by_id(2) is None
