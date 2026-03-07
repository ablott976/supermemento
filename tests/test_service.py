from __future__ import annotations

import pytest

try:
    from app.service import Item, ItemService
except ModuleNotFoundError:
    Item = None
    ItemService = None

pytestmark = pytest.mark.skipif(
    Item is None or ItemService is None,
    reason="app.service module is required"
)


class TestItemService:
    """Test suite for ItemService."""

    def test_add_item(self) -> None:
        """Test adding items."""
        service = ItemService()
        item = Item(name="test", value=10)
        service.add_item(item)
        assert len(service._items) == 1

    def test_get_total_value_empty(self) -> None:
        """Test total value with no items."""
        service = ItemService()
        assert service.get_total_value() == 0

    def test_get_total_value_with_items(self) -> None:
        """Test total value calculation."""
        service = ItemService()
        service.add_item(Item(name="a", value=10))
        service.add_item(Item(name="b", value=20))
        assert service.get_total_value() == 30

    def test_get_items_above_threshold(self) -> None:
        """Test filtering items by threshold."""
        service = ItemService()
        service.add_item(Item(name="low", value=5))
        service.add_item(Item(name="high", value=15))
        result = service.get_items_above_threshold(10)
        assert len(result) == 1
        assert result[0].name == "high"
