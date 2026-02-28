from fastapi import APIRouter, status
from fastapi.responses import JSONResponse

from app.db.neo4j import get_neo4j_driver

router = APIRouter()


@router.get("/health")
async def health_check() -> dict[str, str] | JSONResponse:
    """Health check endpoint to verify Neo4j connection."""
    try:
        driver = await get_neo4j_driver()
        await driver.verify_connectivity()
        return {
            "status": "ok",
            "neo4j": "connected",
        }
    except Exception as e:
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={
                "status": "error",
                "neo4j": f"disconnected: {str(e)}",
            },
        )
