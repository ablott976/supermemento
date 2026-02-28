from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.health import router as health_router
from app.db.neo4j import close_neo4j_driver, init_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await init_db()
    yield
    # Shutdown
    await close_neo4j_driver()


app = FastAPI(title="Supermemento", lifespan=lifespan)
app.include_router(health_router)
