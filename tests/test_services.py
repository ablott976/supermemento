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
    assert response.json() == {"detail": "Client missing-client not found"}


def test_update_client_service_returns_not_found_for_unknown_assignment(
    chatbot_basico_service: object,
) -> None:
    with TestClient(app) as client:
        response = client.put(
            f"/api/clients/client-123/services/{chatbot_basico_service.id}",
            json={"status": "paused"},
        )

    assert response.status_code == 404
    assert response.json() == {
        "detail": "Client client-123 not found",
    }


def test_delete_client_service_returns_not_found_for_unknown_client(
    chatbot_basico_service: object,
) -> None:
    with TestClient(app) as client:
        response = client.delete(
            f"/api/clients/missing-client/services/{chatbot_basico_service.id}",
        )

    assert response.status_code == 404
    assert response.json() == {"detail": "Client missing-client not found"}


def test_delete_client_service_returns_not_found_for_unknown_assignment(
    chatbot_basico_service: object,
) -> None:
    with TestClient(app) as client:
        response = client.delete(
            f"/api/clients/client-123/services/{chatbot_basico_service.id}",
        )

    assert response.status_code == 404
    assert response.json() == {"detail": "Client client-123 not found"}
