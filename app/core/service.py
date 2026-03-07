"""Core service module for data processing."""

from typing import Any

import requests
from pydantic import BaseModel, ValidationError


class DataItem(BaseModel):
    """Model for data items."""
    
    id: int
    name: str
    value: float | None = None


class DataService:
    """Service for handling data operations."""
    
    def __init__(self, api_url: str) -> None:
        """Initialize service with API URL."""
        self.api_url = api_url
        self._cache: dict[int, DataItem] = {}
    
    def fetch_item(self, item_id: int) -> DataItem:
        """Fetch item from API or cache."""
        if item_id in self._cache:
            return self._cache[item_id]
        
        try:
            response = requests.get(
                f"{self.api_url}/items/{item_id}", 
                timeout=30,
            )
            response.raise_for_status()
            data = response.json()
            item = DataItem(**data)
            self._cache[item_id] = item
            return item
        except ValidationError as e:
            raise ValueError(f"Invalid data received: {e}") from e
        except requests.RequestException as e:
            raise ConnectionError(f"Failed to fetch item {item_id}: {e}") from e
    
    def process_items(self, items: list[DataItem]) -> dict[str, Any]:
        """Process list of items and return statistics."""
        if not items:
            return {"count": 0, "total": 0.0, "average": 0.0}
        
        values = [item.value for item in items if item.value is not None]
        count = len(values)
        total = sum(values)
        average = total / count if count > 0 else 0.0
        
        return {
            "count": count,
            "total": total,
            "average": average,
        }
