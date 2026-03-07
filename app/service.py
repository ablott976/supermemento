"""Service module for business logic."""

from dataclasses import dataclass


@dataclass
class Item:
    """Represents an item with name and value."""

    name: str
    value: int


class ItemService:
    """Service for managing items."""

    def __init__(self) -> None:
        """Initialize empty item storage."""
        self._items: list[Item] = []

    def add_item(self, item: Item) -> None:
        """Add an item to storage.
        
        Args:
            item: The item to add.
        """
        self._items.append(item)

    def get_total_value(self) -> int:
        """Calculate total value of all items.
        
        Returns:
            Sum of all item values.
        """
        return sum(item.value for item in self._items)

    def get_items_above_threshold(self, threshold: int) -> list[Item]:
        """Filter items above value threshold.
        
        Args:
            threshold: Minimum value to include.
            
        Returns:
            List of items with value > threshold.
        """
        return [item for item in self._items if item.value > threshold]
