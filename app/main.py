from contextlib import asynccontextmanager
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from app.config import settings
from app.db.neo4j import close_neo4j_driver, get_neo4j_driver, init_db

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await init_db()
    yield
    # Shutdown
    await close_neo4j_driver()


app = FastAPI(title="Supermemento", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health_check() -> dict[str, str]:
    try:
        driver = await get_neo4j_driver()
        await driver.verify_connectivity()
        neo4j_status = "connected"
    except Exception as e:
        logger.error("Health check failed: %s", e, exc_info=True)
        neo4j_status = "disconnected"
    return {
        "status": "ok",
        "neo4j": neo4j_status,
    }


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=settings.MCP_SERVER_PORT)
