from contextlib import asynccontextmanager
from fastapi import FastAPI

from app.config import settings
from app.db.neo4j import init_db, close_neo4j_driver

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await init_db()
    yield
    # Shutdown
    await close_neo4j_driver()

app = FastAPI(title="Supermemento", lifespan=lifespan)

@app.get("/health")
async def health_check():
    from app.db.neo4j import get_neo4j_driver
    try:
        driver = await get_neo4j_driver()
        await driver.verify_connectivity()
        neo4j_status = "connected"
    except Exception as e:
        neo4j_status = f"disconnected: {e}"
    return {
        "status": "ok",
        "neo4j": neo4j_status
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=settings.MCP_SERVER_PORT)
