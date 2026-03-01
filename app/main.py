from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI

from app.api.health import router as health_router
from app.db.neo4j import close_neo4j_driver, create_constraints_and_indexes, init_db


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Manage application lifespan."""
    # Startup
    await init_db()
    await create_constraints_and_indexes()
    yield
    # Shutdown
    await close_neo4j_driver()


app = FastAPI(title="Supermemento", lifespan=lifespan)
app.include_router(health_router)
