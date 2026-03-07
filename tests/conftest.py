"""Shared pytest fixtures."""

from __future__ import annotations

import asyncio
from typing import Any
from collections.abc import Generator

import pytest

@pytest.fixture
def chatbot_basico_service() -> Generator[Any, None, None]:
    """Seed the chatbot_basico service in the shared service catalog."""
    try:
        from app.api.services import get_service_catalog
        from app.services.service_catalog import ServiceCatalogService
    except ModuleNotFoundError:
        pytest.skip("fastapi and app services are required for chatbot_basico fixture")

    service_catalog: ServiceCatalogService = get_service_catalog()
    original_services = dict(service_catalog._services)
    original_client_services = {
        client_id: dict(client_services)
        for client_id, client_services in service_catalog._client_services.items()
    }

    service_catalog._services.clear()
    service_catalog._client_services.clear()
    seeded_service = asyncio.run(
        service_catalog.create_service(
            name="chatbot_basico",
            status="active",
            container_tag="chatbot_basico",
        )
    )

    yield seeded_service

    service_catalog._services.clear()
    service_catalog._services.update(original_services)
    service_catalog._client_services.clear()
    service_catalog._client_services.update(original_client_services)
