"""Dashboard routes for services, chatbot configuration, and conversations."""

from typing import Any

from flask import Blueprint, jsonify, request

# Create blueprint for dashboard routes
dashboard_bp = Blueprint("dashboard", __name__, url_prefix="/dashboard")


@dashboard_bp.route("/services", methods=["GET"])
def get_services() -> dict[str, Any]:
    """Retrieve list of all services.
    
    Returns:
        Dictionary containing services data.
    """
    try:
        services = [
            {"id": 1, "name": "Service A", "status": "active"},
            {"id": 2, "name": "Service B", "status": "inactive"},
        ]
        return jsonify({"services": services, "status": "success"})
    except Exception as e:
        return jsonify({"error": str(e), "status": "error"}), 500


@dashboard_bp.route("/services", methods=["POST"])
def create_service() -> tuple[dict[str, Any], int]:
    """Create a new service.
    
    Returns:
        Tuple of response dictionary and HTTP status code.
        
    Raises:
        ValueError: If request data is empty or invalid.
    """
    try:
        data = request.get_json()
        if not data:
            raise ValueError("Service data cannot be empty")
        
        new_service = {
            "id": 3,
            "name": data.get("name"),
            "status": data.get("status", "inactive"),
        }
        return jsonify({"service": new_service, "status": "success"}), 201
    except ValueError as e:
        return jsonify({"error": str(e), "status": "error"}), 400
    except Exception as e:
        return jsonify({"error": str(e), "status": "error"}), 500


@dashboard_bp.route("/services/<int:service_id>", methods=["PUT"])
def update_service(service_id: int) -> dict[str, Any]:
    """Update an existing service.
    
    Args:
        service_id: ID of the service to update.
        
    Returns:
        Updated service data.
        
    Raises:
        ValueError: If update data is empty.
    """
    try:
        data = request.get_json()
        if not data:
            raise ValueError("Update data cannot be empty")
        
        updated_service = {
            "id": service_id,
            "name": data.get("name"),
            "status": data.get("status"),
        }
        return jsonify({"service": updated_service, "status": "success"})
    except ValueError as e:
        return jsonify({"error": str(e), "status": "error"}), 400
    except Exception as e:
        return jsonify({"error": str(e), "status": "error"}), 500


@dashboard_bp.route("/services/<int:service_id>", methods=["DELETE"])
def delete_service(service_id: int) -> tuple[dict[str, Any], int]:
    """Delete a service.
    
    Args:
        service_id: ID of the service to delete.
        
    Returns:
        Tuple of response dictionary and HTTP status code.
    """
    try:
        return jsonify({"message": f"Service {service_id} deleted", "status": "success"}), 200
    except Exception as e:
        return jsonify({"error": str(e), "status": "error"}), 500


@dashboard_bp.route("/chatbot-config", methods=["GET"])
def get_chatbot_config() -> dict[str, Any]:
    """Retrieve chatbot configuration.
    
    Returns:
        Dictionary containing chatbot configuration settings.
    """
    try:
        config = {
            "model": "gpt-4",
            "temperature": 0.7,
            "max_tokens": 150,
            "system_prompt": "You are a helpful assistant.",
        }
        return jsonify({"config": config, "status": "success"})
    except Exception as e:
        return jsonify({"error": str(e), "status": "error"}), 500


@dashboard_bp.route("/chatbot-config", methods=["PUT", "POST"])
def update_chatbot_config() -> dict[str, Any]:
    """Update chatbot configuration.
    
    Returns:
        Updated configuration data.
        
    Raises:
        ValueError: If configuration data is empty or missing required fields.
    """
    try:
        data = request.get_json()
        if not data:
            raise ValueError("Configuration data cannot be empty")
        
        required_fields = ["model", "temperature"]
        for field in required_fields:
            if field not in data:
                raise ValueError(f"Missing required field: {field}")
        
        updated_config = {
            "model": data["model"],
            "temperature": float(data["temperature"]),
            "max_tokens": data.get("max_tokens", 150),
            "system_prompt": data.get("system_prompt", ""),
        }
        return jsonify({"config": updated_config, "status": "success"})
    except ValueError as e:
        return jsonify({"error": str(e), "status": "error"}), 400
    except Exception as e:
        return jsonify({"error": str(e), "status": "error"}), 500


@dashboard_bp.route("/conversations", methods=["GET"])
def get_conversations() -> dict[str, Any]:
    """Retrieve list of conversations.
    
    Returns:
        Dictionary containing conversation summaries.
    """
    try:
        conversations = [
            {
                "id": "conv_001",
                "user_id": "user_123",
                "status": "active",
                "message_count": 15,
                "last_activity": "2024-01-15T10:30:00Z",
            },
            {
                "id": "conv_002",
                "user_id": "user_456",
                "status": "closed",
                "message_count": 8,
                "last_activity": "2024-01-14T16:45:00Z",
            },
        ]
        return jsonify({"conversations": conversations, "status": "success"})
    except Exception as e:
        return jsonify({"error": str(e), "status": "error"}), 500


@dashboard_bp.route("/conversations/<string:conversation_id>", methods=["GET"])
def get_conversation_detail(conversation_id: str) -> dict[str, Any]:
    """Retrieve detailed conversation data.
    
    Args:
        conversation_id: Unique identifier for the conversation.
        
    Returns:
        Detailed conversation data including messages.
        
    Raises:
        ValueError: If conversation_id is empty.
    """
    try:
        if not conversation_id:
            raise ValueError("Conversation ID cannot be empty")
        
        conversation = {
            "id": conversation_id,
            "messages": [
                {"role": "user", "content": "Hello", "timestamp": "2024-01-15T10:00:00Z"},
                {"role": "assistant", "content": "Hi! How can I help?", "timestamp": "2024-01-15T10:00:05Z"},
            ],
            "metadata": {
                "user_agent": "Mozilla/5.0",
                "ip_address": "192.168.1.1",
            },
        }
        return jsonify({"conversation": conversation, "status": "success"})
    except ValueError as e:
        return jsonify({"error": str(e), "status": "error"}), 400
    except Exception as e:
        return jsonify({"error": str(e), "status": "error"}), 500


@dashboard_bp.route("/conversations/<string:conversation_id>", methods=["DELETE"])
def delete_conversation(conversation_id: str) -> tuple[dict[str, Any], int]:
    """Delete a conversation.
    
    Args:
        conversation_id: Unique identifier for the conversation to delete.
        
    Returns:
        Tuple of response dictionary and HTTP status code.
        
    Raises:
        ValueError: If conversation_id is empty.
    """
    try:
        if not conversation_id:
            raise ValueError("Conversation ID cannot be empty")
        
        return jsonify({"message": f"Conversation {conversation_id} deleted", "status": "success"}), 200
    except ValueError as e:
        return jsonify({"error": str(e), "status": "error"}), 400
    except Exception as e:
        return jsonify({"error": str(e), "status": "error"}), 500
