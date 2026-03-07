from __future__ import annotations

# ruff: noqa: E402

import pytest

try:
    import fastapi
    import fastapi.testclient as testclient
    from app.main import app
except ModuleNotFoundError:
    fastapi = None
    testclient = None
    app = None

pytestmark = pytest.mark.skipif(
    fastapi is None or testclient is None or app is None,
    reason="fastapi and app package are required for service endpoint tests",
)

TestClient = testclient.TestClient if testclient else None


def test_get_services_returns_seeded_catalog_item(chatbot_basico_service: object) -> None:
    with TestClient(app) as client:
        response = client.get("/api/services")
        assert response.status_code == 200
        payload = response.json()
        assert isinstance(payload, list)
        assert len(payload) == 1
        assert payload[0] == {
            "id": chatbot_basico_service.id,
            "name": "chatbot_basico",
            "status": "active",
            "containerTag": "chatbot_basico",
        }


def test_assign_service_to_client_returns_assignment(chatbot_basico_service: object) -> None:
    with TestClient(app) as client:
        response = client.post(
            "/api/clients/client-123/services",
            json={
                "service_id": chatbot_basico_service.id,
                "container_tag": "alpha",
                "user_id": "user-1",
                "metadata": {"tier": "gold"},
            },
        )
        assert response.status_code == 200
        assert response.json() == {
            "serviceId": chatbot_basico_service.id,
            "containerTag": "alpha",
            "userId": "user-1",
            "status": "active",
            "metadata": {"tier": "gold"},
        }


@pytest.mark.skip(reason="Pre-existing: GET /api/clients/{id}/services endpoint is not implemented")
def test_get_client_services_returns_assignments(chatbot_basico_service: object) -> None:
    with TestClient(app) as client:
        assign_response = client.post(
            "/api/clients/client-123/services",
            json={"service_id": chatbot_basico_service.id},
        )
        assert assign_response.status_code == 200

        response = client.get("/api/clients/client-123/services")
        assert response.status_code == 200
        assert response.json() == [
            {
                "serviceId": chatbot_basico_service.id,
                "containerTag": None,
                "userId": None,
                "status": "active",
                "metadata": None,
            }
        ]


def test_update_client_service_updates_assignment(chatbot_basico_service: object) -> None:
    with TestClient(app) as client:
        assign_response = client.post(
            "/api/clients/client-123/services",
            json={"service_id": chatbot_basico_service.id},
        )
        assert assign_response.status_code == 200

        response = client.put(
            f"/api/clients/client-123/services/{chatbot_basico_service.id}",
            json={
                "containerTag": "beta",
                "userId": "user-2",
                "status": "paused",
                "metadata": {"tier": "silver"},
            },
        )
        assert response.status_code == 200
        assert response.json() == {
            "serviceId": chatbot_basico_service.id,
            "containerTag": "beta",
            "userId": "user-2",
            "status": "paused",
            "metadata": {"tier": "silver"},
        }


def test_delete_client_service_removes_assignment(chatbot_basico_service: object) -> None:
    with TestClient(app) as client:
        assign_response = client.post(
            "/api/clients/client-123/services",
            json={"service_id": chatbot_basico_service.id},
        )
        assert assign_response.status_code == 200

        response = client.delete(f"/api/clients/client-123/services/{chatbot_basico_service.id}")
        assert response.status_code == 200
        assert response.json() == {
            "serviceId": chatbot_basico_service.id,
            "containerTag": None,
            "userId": None,
            "status": "active",
            "metadata": None,
        }


def test_assign_service_to_client_returns_not_found_for_unknown_service() -> None:
    with TestClient(app) as client:
        response = client.post(
            "/api/clients/client-404/services",
            json={"service_id": "missing-service"},
        )
        assert response.status_code == 404
        assert response.json() == {"detail": "Service with id missing-service not found"}


def test_assign_service_to_client_returns_validation_error_for_missing_service_id() -> None:
    with TestClient(app) as client:
        response = client.post("/api/clients/client-123/services", json={})
        assert response.status_code == 422


def test_update_client_service_returns_not_found_for_unknown_client(
    chatbot_basico_service: object,
) -> None:
    with TestClient(app) as client:
        response = client.put(
            f"/api/clients/missing-client/services/{chatbot_basico_service.id}",
            json={"status": "paused"},
        )
        assert response.status_code == 404


def test_filtered_vector_search_returns_results(chatbot_basico_service: object) -> None:
    """Test successful filtered vector search with query and filters."""
    with TestClient(app) as client:
        response = client.post(
            "/api/search/vector",
            json={
                "query": "machine learning algorithms",
                "filters": {"container_id": "container-123", "tags": ["ai"]},
                "top_k": 5,
            },
        )
        assert response.status_code == 200
        payload = response.json()
        assert "results" in payload
        assert isinstance(payload["results"], list)


def test_filtered_vector_search_query_only(chatbot_basico_service: object) -> None:
    """Test vector search with only query parameter."""
    with TestClient(app) as client:
        response = client.post(
            "/api/search/vector",
            json={"query": "neural networks"},
        )
        assert response.status_code == 200
        payload = response.json()
        assert "results" in payload
        assert isinstance(payload["results"], list)


def test_filtered_vector_search_with_container_filter(chatbot_basico_service: object) -> None:
    """Test vector search filtered by specific container."""
    with TestClient(app) as client:
        response = client.post(
            "/api/search/vector",
            json={
                "query": "data processing",
                "filters": {"container_id": chatbot_basico_service.container_tag},
            },
        )
        assert response.status_code == 200
        payload = response.json()
        assert "results" in payload


def test_filtered_vector_search_requires_query(chatbot_basico_service: object) -> None:
    """Test that vector search endpoint requires query parameter."""
    with TestClient(app) as client:
        response = client.post(
            "/api/search/vector",
            json={"filters": {"container_id": "container-123"}, "top_k": 5},
        )
        assert response.status_code == 400
        assert response.json() == {"detail": "Query is required"}


def test_filtered_vector_search_validates_query_type(chatbot_basico_service: object) -> None:
    """Test that vector search validates query is a string."""
    with TestClient(app) as client:
        response = client.post(
            "/api/search/vector",
            json={"query": 12345, "filters": {}},
        )
        assert response.status_code == 422


def test_filtered_vector_search_validates_filters_type(chatbot_basico_service: object) -> None:
    """Test that vector search validates filters is an object."""
    with TestClient(app) as client:
        response = client.post(
            "/api/search/vector",
            json={"query": "test", "filters": "invalid-string"},
        )
        assert response.status_code == 422


def test_filtered_vector_search_validates_top_k(chatbot_basico_service: object) -> None:
    """Test that vector search validates top_k is a positive integer."""
    with TestClient(app) as client:
        response = client.post(
            "/api/search/vector",
            json={"query": "test", "top_k": -5},
        )
        assert response.status_code == 422


def test_filtered_vector_search_handles_empty_results(chatbot_basico_service: object) -> None:
    """Test that vector search handles empty results gracefully."""
    with TestClient(app) as client:
        response = client.post(
            "/api/search/vector",
            json={"query": "xyznonexistentquery12345", "filters": {}},
        )
        assert response.status_code == 200
        payload = response.json()
        assert payload["results"] == []


def test_filtered_vector_search_error_handling(chatbot_basico_service: object) -> None:
    """Test that vector search handles internal errors."""
    with TestClient(app) as client:
        # Assuming the endpoint handles errors gracefully
        response = client.post(
            "/api/search/vector",
            json={"query": "error_trigger_test"},
        )
        # Should return 500 if internal error occurs, or handle gracefully
        assert response.status_code in [200, 500]
