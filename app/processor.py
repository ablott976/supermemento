"""Data processing module with validation."""

from typing import Any


class DataProcessor:
    """Process and store data items with validation."""
    
    def __init__(self) -> None:
        """Initialize empty processor."""
        self._items: list[dict[str, Any]] = []
    
    def add_item(self, item: dict[str, Any]) -> None:
        """Add item after validation.
        
        Args:
            item: Dictionary containing at least an 'id' key.
            
        Raises:
            TypeError: If item is not a dict.
            ValueError: If item lacks 'id' key.
        """
        if not isinstance(item, dict):
            raise TypeError("Item must be a dictionary")
        if "id" not in item:
            raise ValueError("Item must contain 'id' key")
        self._items.append(item)
    
    def get_by_id(self, item_id: int) -> dict[str, Any] | None:
        """Retrieve item by ID.
        
        Args:
            item_id: The ID to search for.
            
        Returns:
            The matching item or None if not found.
        """
        for item in self._items:
            if item.get("id") == item_id:
                return item
        return None
    
    def clear(self) -> None:
        """Remove all stored items."""
        self._items.clear()
    
    def count(self) -> int:
        """Return number of stored items."""
        return len(self._items)
