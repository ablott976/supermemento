"""Service catalog API endpoints."""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from app.schemas.service import (
    AssignServiceRequest,
    ClientServiceResponse,
    ClientServiceUpdate,
    ServiceResponse,
    ServiceSearchRequest,
)
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


@router.post("/api/services/search", response_model=list[ServiceResponse])
async def search_services(
    search_request: ServiceSearchRequest,
    service_catalog: Annotated[ServiceCatalogService, Depends(get_service_catalog)],
) -> list[ServiceResponse]:
    """Search services using filtered vector search."""
    return await service_catalog.search_services(
        query=search_request.query,
        status=search_request.status,
        limit=search_request.limit,
    )


@router.post(
    "/api/clients/{id}/services",
    response_model=ClientServiceResponse,
)
async def assign_service_to_client(
    id: str,
    service_assignment: AssignServiceRequest,
    service_catalog: Annotated[ServiceCatalogService, Depends(get_service_catalog)],
) -> ClientServiceResponse:
    """Assign a service to a client."""
    try:
        return await service_catalog.assign_service_to_client(id, service_assignment)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.put(
    "/api/clients/{id}/services/{sid}",
    response_model=ClientServiceResponse,
)
async def update_client_service(
    id: str,
    sid: str,
    service_update: ClientServiceUpdate,
    service_catalog: Annotated[ServiceCatalogService, Depends(get_service_catalog)],
) -> ClientServiceResponse:
    """Update a service assignment for a client."""
    try:
        return await service_catalog.update_client_service(id, sid, service_update)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete(
    "/api/clients/{id}/services/{sid}",
    response_model=ClientServiceResponse,
)
async def delete_client_service(
    id: str,
    sid: str,
    service_catalog: Annotated[ServiceCatalogService, Depends(get_service_catalog)],
) -> ClientServiceResponse:
    """Delete a service assignment for a client."""
    try:
        return await service_catalog.delete_client_service(id, sid)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
