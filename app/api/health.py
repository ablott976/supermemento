"""Health-check API endpoints."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from app.db.neo4j import get_neo4j_driver

router = APIRouter()


@router.get("/health")
async def health_check(driver: Any = Depends(get_neo4j_driver)) -> dict[str, str]:
    """Return service health, validating Neo4j connectivity."""
    try:
        await driver.verify_connectivity()
    except (
        Exception
    ) as exc:  # pragma: no cover - explicit error path tested via API response
        raise HTTPException(
            status_code=503,
            detail="Neo4j connectivity check failed",
        ) from exc

    return {"status": "ok", "neo4j": "connected"}
