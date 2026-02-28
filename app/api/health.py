from fastapi import APIRouter
from app.db.neo4j import get_neo4j_driver

router = APIRouter()


@router.get("/health")
async def health_check() -> dict[str, str]:
    """Health check endpoint to verify Neo4j connection."""
    try:
        driver = await get_neo4j_driver()
        await driver.verify_connectivity()
        neo4j_status = "connected"
    except Exception as e:
        neo4j_status = f"disconnected: {e}"
    return {
        "status": "ok",
        "neo4j": neo4j_status,
    }
