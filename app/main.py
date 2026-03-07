from __future__ import annotations

import logging
import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger(__name__)


# Pydantic models
class Item(BaseModel):
    id: int | None = None
    name: str = Field(..., min_length=1, max_length=100)
    description: str | None = Field(None, max_length=255)
    price: float = Field(..., gt=0)
    is_active: bool = True

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "name": "Sample Item",
                "description": "A sample item description",
                "price": 10.99,
                "is_active": True,
            }
        }
    )


class ItemUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=100)
    description: str | None = Field(None, max_length=255)
    price: float | None = Field(None, gt=0)
    is_active: bool | None = None


class HealthResponse(BaseModel):
    status: str
    version: str = "1.0.0"


# In-memory storage for demo purposes
items_db: dict[int, Item] = {}
counter: int = 0


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan events."""
    global items_db, counter
    items_db = {}
    counter = 0
    logger.info("Starting up application...")
    yield
    logger.info("Shutting down application...")


# Create FastAPI app
app = FastAPI(
    title="Items API",
    description="A simple API for managing items",
    version="1.0.0",
    lifespan=lifespan,
)


@app.get("/", response_model=dict)
async def root():
    """Root endpoint."""
    return {
        "message": "Welcome to Items API",
        "docs": "/docs",
        "health": "/health",
    }


@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint."""
    return HealthResponse(status="healthy")


@app.post("/items", response_model=Item, status_code=status.HTTP_201_CREATED)
async def create_item(item: Item):
    """Create a new item."""
    global counter
    counter += 1
    item.id = counter
    items_db[counter] = item
    logger.info("Created item with id %s", counter)
    return item


@app.get("/items", response_model=list[Item])
async def list_items(skip: int = 0, limit: int = 100, active_only: bool = False):
    """List all items with optional filtering."""
    result = list(items_db.values())
    if active_only:
        result = [item for item in result if item.is_active]
    return result[skip : skip + limit]


@app.get("/items/{item_id}", response_model=Item)
async def get_item(item_id: int):
    """Get a specific item by ID."""
    if item_id not in items_db:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Item with id {item_id} not found",
        )
    return items_db[item_id]


@app.put("/items/{item_id}", response_model=Item)
async def update_item(item_id: int, item_update: ItemUpdate):
    """Update an existing item."""
    if item_id not in items_db:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Item with id {item_id} not found",
        )
    stored_item = items_db[item_id]
    update_data = item_update.model_dump(exclude_unset=True, exclude_none=True)
    updated_item = stored_item.model_copy(update=update_data)
    items_db[item_id] = updated_item
    logger.info("Updated item with id %s", item_id)
    return updated_item


@app.delete("/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_item(item_id: int):
    """Delete an item."""
    if item_id not in items_db:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Item with id {item_id} not found",
        )
    del items_db[item_id]
    logger.info("Deleted item with id %s", item_id)
