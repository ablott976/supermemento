from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.db.neo4j import close_neo4j_driver, get_neo4j_driver, init_db


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
        neo4j_status = f"disconnected: {e}"
    return {
        "status": "ok",
        "neo4j": neo4j_status,
    }
