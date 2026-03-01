import logging
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI

from app.config import settings
from app.db.neo4j import close_neo4j_driver, get_neo4j_driver, init_db

# Configure logging
logging.basicConfig(level=settings.LOG_LEVEL.upper())
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await init_db()
    yield
    # Shutdown
    await close_neo4j_driver()


app = FastAPI(title="Supermemento", lifespan=lifespan)


@app.get("/health")
async def health_check() -> dict[str, str]:
    try:
        driver = await get_neo4j_driver()
        await driver.verify_connectivity()
        neo4j_status = "connected"
    except Exception as e:
        logger.error(f"Database connection failed: {e}", exc_info=True)
        neo4j_status = "disconnected"
    return {
        "status": "ok",
        "neo4j": neo4j_status,
    }


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=settings.MCP_SERVER_PORT)
