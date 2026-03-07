"""Service catalog API endpoints."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends

from app.schemas.service import ServiceResponse
from app.services.service_catalog import ServiceCatalogService

router = APIRouter()

_service_catalog = ServiceCatalogService()


def get_service_catalog() -> ServiceCatalogService:
    """Return the shared service catalog service instance."""
    return _service_catalog


@router.get("/api/services", response_model=list[ServiceResponse])
async def get_services(
    service_catalog: Annotated[ServiceCatalogService, Depends(get_service_catalog)],
) -> list[ServiceResponse]:
    """Return all services in the catalog."""
    return await service_catalog.get_all_services()
