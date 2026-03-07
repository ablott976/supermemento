"""Tests for service catalog API endpoints."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


class TestGetServices:
    """Tests for GET /api/services endpoint."""

    def test_get_services_returns_list(self) -> None:
        """Test that GET /api/services returns a list."""
        response = client.get("/api/services")
        assert response.status_code == 200
        assert isinstance(response.json(), list)

    def test_get_services_includes_seeded_service(self, chatbot_basico_service) -> None:
        """Test that seeded service appears in the list."""
        response = client.get("/api/services")
        assert response.status_code == 200
        services = response.json()
        assert len(services) >= 1
        assert any(s["name"] == "chatbot_basico" for s in services)


class TestAssignServiceToClient:
    """Tests for POST /api/clients/{id}/services endpoint."""

    def test_assign_service_success(self, chatbot_basico_service) -> None:
        """Test successful assignment of service to client."""
        service_id = chatbot_basico_service.id
        client_id = "test-client-assign"
        payload = {
            "service_id": service_id,
            "container_tag": "test-container",
            "user_id": "test-user",
            "metadata": {"env": "test"},
        }

        response = client.post(f"/api/clients/{client_id}/services", json=payload)
        assert response.status_code == 200
        data = response.json()
        assert data["service_id"] == service_id
        assert data["container_tag"] == "test-container"
        assert data["user_id"] == "test-user"
        assert data["status"] == "active"
        assert data["metadata"] == {"env": "test"}

    def test_assign_service_not_found(self) -> None:
        """Test 404 error when assigning non-existent service."""
        client_id = "test-client-error"
        payload = {"service_id": "non-existent-uuid", "container_tag": "test"}

        response = client.post(f"/api/clients/{client_id}/services", json=payload)
        assert response.status_code == 404
        assert "not found" in response.json()["detail"].lower()

    def test_assign_service_minimal_payload(self, chatbot_basico_service) -> None:
        """Test assignment with only required fields."""
        service_id = chatbot_basico_service.id
        client_id = "test-client-minimal"
        payload = {"service_id": service_id}

        response = client.post(f"/api/clients/{client_id}/services", json=payload)
        assert response.status_code == 200
        data = response.json()
        assert data["service_id"] == service_id
        assert data["status"] == "active"
        assert data["container_tag"] is None
        assert data["user_id"] is None
        assert data["metadata"] is None


class TestGetClientServices:
    """Tests for GET /api/clients/{id}/services endpoint."""

    def test_get_client_services_empty(self) -> None:
        """Test getting services for client with no assignments."""
        client_id = "client-no-services"
        response = client.get(f"/api/clients/{client_id}/services")
        assert response.status_code == 200
        assert response.json() == []

    def test_get_client_services_with_data(self, chatbot_basico_service) -> None:
        """Test getting services after assignment."""
        service_id = chatbot_basico_service.id
        client_id = "test-client-get"
        
        # Assign service first
        assign_payload = {"service_id": service_id, "container_tag": "get-test"}
        client.post(f"/api/clients/{client_id}/services", json=assign_payload)
        
        # Get services
        response = client.get(f"/api/clients/{client_id}/services")
        assert response.status_code == 200
        services = response.json()
        assert len(services) == 1
        assert services[0]["service_id"] == service_id
        assert services[0]["container_tag"] == "get-test"


class TestUpdateClientService:
    """Tests for PUT /api/clients/{id}/services/{sid} endpoint."""

    def test_update_service_full(self, chatbot_basico_service) -> None:
        """Test updating all fields of client service."""
        service_id = chatbot_basico_service.id
        client_id = "test-client-update-full"
        
        # Setup: assign service
        client.post(
            f"/api/clients/{client_id}/services",
            json={
                "service_id": service_id,
                "container_tag": "original",
                "user_id": "original-user",
                "status": "active",
                "metadata": {"key": "original"},
            },
        )
        
        # Update all fields
        update_payload = {
            "container_tag": "updated",
            "user_id": "updated-user",
            "status": "inactive",
            "metadata": {"key": "updated"},
        }
        response = client.put(
            f"/api/clients/{client_id}/services/{service_id}",
            json=update_payload,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["container_tag"] == "updated"
        assert data["user_id"] == "updated-user"
        assert data["status"] == "inactive"
        assert data["metadata"] == {"key": "updated"}

    def test_update_service_partial(self, chatbot_basico_service) -> None:
        """Test partial update (only status)."""
        service_id = chatbot_basico_service.id
        client_id = "test-client-update-partial"
        
        # Setup
        client.post(
            f"/api/clients/{client_id}/services",
            json={"service_id": service_id, "container_tag": "partial-test", "user_id": "user"},
        )
        
        # Partial update
        response = client.put(
            f"/api/clients/{client_id}/services/{service_id}",
            json={"status": "suspended"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "suspended"
        assert data["container_tag"] == "partial-test"  # Unchanged
        assert data["user_id"] == "user"  # Unchanged

    def test_update_service_client_not_found(self) -> None:
        """Test 404 when client has no services."""
        response = client.put(
            "/api/clients/non-existent-client/services/some-service",
            json={"status": "inactive"},
        )
        assert response.status_code == 404
        assert "not found" in response.json()["detail"].lower()

    def test_update_service_service_not_found(self, chatbot_basico_service) -> None:
        """Test 404 when service not assigned to client."""
        client_id = "test-client-no-service"
        # Create client with no services by just getting (creates empty entry)
        client.get(f"/api/clients/{client_id}/services")
        
        response = client.put(
            f"/api/clients/{client_id}/services/non-existent-service",
            json={"status": "inactive"},
        )
        assert response.status_code == 404


class TestDeleteClientService:
    """Tests for DELETE /api/clients/{id}/services/{sid} endpoint."""

    def test_delete_service_success(self, chatbot_basico_service) -> None:
        """Test successful deletion of client service."""
        service_id = chatbot_basico_service.id
        client_id = "test-client-delete"
        
        # Setup
        client.post(
            f"/api/clients/{client_id}/services",
            json={"service_id": service_id, "container_tag": "delete-test"},
        )
        
        # Delete
        response = client.delete(f"/api/clients/{client_id}/services/{service_id}")
        assert response.status_code == 200
        data = response.json()
        assert data["service_id"] == service_id
        
        # Verify deletion
        get_response = client.get(f"/api/clients/{client_id}/services")
        assert get_response.json() == []

    def test_delete_service_not_found(self) -> None:
        """Test 404 when deleting non-existent service assignment."""
        response = client.delete("/api/clients/unknown-client/services/unknown-service")
        assert response.status_code == 404
        assert "not found" in response.json()["detail"].lower()
