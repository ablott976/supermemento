"""Application entrypoint."""
from __future__ import annotations

from fastapi import FastAPI

from app.api.health import router as health_router
from app.api.services import router as services_router

app = FastAPI()
app.include_router(health_router)
app.include_router(services_router)
