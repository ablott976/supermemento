"""Main application module."""

from fastapi import FastAPI

app = FastAPI(title="Example API")


@app.get("/")
async def root() -> dict[str, str]:
    """Return root message."""
    return {"message": "Hello World"}


@app.get("/items/{item_id}")
async def read_item(item_id: int, q: str | None = None) -> dict[str, object]:
    """Read item by ID."""
    result: dict[str, object] = {"item_id": item_id}
    if q:
        result["q"] = q
    return result
