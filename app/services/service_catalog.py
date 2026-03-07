"""Service catalog management logic."""

from __future__ import annotations

import uuid

from app.schemas.service import (
    AssignServiceRequest,
    ClientServiceResponse,
    ClientServiceUpdate,
    ServiceResponse,
)


class ServiceCatalogService:
    """Manage in-memory service catalog and client service assignments."""

    def __init__(self) -> None:
        self._services: dict[str, ServiceResponse] = {}
        self._client_services: dict[str, dict[str, ClientServiceResponse]] = {}

    async def create_service(
        self,
        name: str,
        status: str,
        container_tag: str | None = None,
    ) -> ServiceResponse:
        """Create and persist a new service definition."""
        service = ServiceResponse(
            id=str(uuid.uuid4()),
            name=name,
            status=status,
            container_tag=container_tag,
        )
        self._services[service.id] = service
        return service

    async def delete_service(self, service_id: str) -> None:
        """Delete a service and remove any client assignments for it."""
        self._services.pop(service_id, None)
        for client_services in self._client_services.values():
            client_services.pop(service_id, None)

    async def get_all_services(self) -> list[ServiceResponse]:
        """Return all cataloged services."""
        return list(self._services.values())

    async def search_services(
        self,
        query: str,
        status: str | None = None,
        limit: int = 10,
    ) -> list[ServiceResponse]:
        """Search services using filtered vector search.

        Performs vector similarity search on service embeddings with optional metadata filtering by status.

        Args:
            query: Search query text to vectorize and match
            status: Optional status filter to apply
            limit: Maximum number of results to return

        Returns:
            List of services matching the query and filters
        """
        # Filter by status first if specified
        candidates = self._services.values()
        if status is not None:
            candidates = [s for s in candidates if s.status == status]

        # Perform vector similarity search (simulated with text matching for in-memory)
        # In production, this would use actual vector embeddings and similarity search
        query_lower = query.lower()
        results = []
        for service in candidates:
            # Simple text similarity as stand-in for vector similarity
            # In real implementation, this would compare embeddings
            if query_lower in service.name.lower() or query_lower in service.status.lower():
                results.append(service)
            if len(results) >= limit:
                break
        return results

    async def get_client_services(self, client_id: str) -> list[ClientServiceResponse]:
        """Return all services assigned to a client."""
        client_services = self._client_services.get(client_id, {})
        return list(client_services.values())

    async def assign_service_to_client(
        self,
        client_id: str,
        service_assignment: AssignServiceRequest,
    ) -> ClientServiceResponse:
        """Assign a catalog service to a client."""
        if service_assignment.service_id not in self._services:
            raise ValueError(f"Service with id {service_assignment.service_id} not found")

        assigned_service = ClientServiceResponse(
            service_id=service_assignment.service_id,
            container_tag=service_assignment.container_tag,
            user_id=service_assignment.user_id,
            status="active",
            metadata=service_assignment.metadata,
        )
        self._client_services.setdefault(client_id, {})[
            service_assignment.service_id
        ] = assigned_service
        return assigned_service

    async def update_client_service(
        self,
        client_id: str,
        service_id: str,
        update_data: ClientServiceUpdate,
    ) -> ClientServiceResponse:
        """Update an assigned service for a client."""
        if client_id not in self._client_services:
            raise ValueError(f"Client {client_id} not found")
        if service_id not in self._client_services[client_id]:
            raise ValueError(f"Service {service_id} not assigned to client {client_id}")

        client_service = self._client_services[client_id][service_id]
        if update_data.container_tag is not None:
            client_service.container_tag = update_data.container_tag
        if update_data.user_id is not None:
            client_service.user_id = update_data.user_id
        if update_data.status is not None:
            client_service.status = update_data.status
        if update_data.metadata is not None:
            client_service.metadata = update_data.metadata
        return client_service

    async def delete_client_service(
        self,
        client_id: str,
        service_id: str,
    ) -> ClientServiceResponse:
        """Delete a service assignment for a client."""
        if client_id not in self._client_services:
            raise ValueError(f"Client {client_id} not found")
        if service_id not in self._client_services[client_id]:
            raise ValueError(f"Service {service_id} not assigned to client {client_id}")
        return self._client_services[client_id].pop(service_id)
