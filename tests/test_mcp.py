import json

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_sse_endpoint_connection(mock_neo4j_driver):
    """Test SSE endpoint establishes connection and sends initial endpoint event."""
    with client.get("/sse", stream=True) as response:
        # Verify response headers
        assert response.status_code == 200
        assert response.headers["content-type"] == "text/event-stream"
        assert response.headers["cache-control"] == "no-cache"
        assert response.headers["connection"] == "keep-alive"
        assert response.headers["x-accel-buffering"] == "no"

        # Parse SSE event stream
        event_type = None
        event_data = None
        for line in response.iter_lines():
            line_str = line.decode("utf-8")
            if line_str.startswith("event: "):
                event_type = line_str[7:]  # Remove "event: " prefix
            elif line_str.startswith("data: "):
                event_data = json.loads(line_str[6:])  # Remove "data: " prefix
                break

        # Verify initial endpoint event structure
        assert event_type == "endpoint"
        assert event_data is not None
        assert "session_id" in event_data
        assert "message_endpoint" in event_data
        assert event_data["message_endpoint"] == "/messages"

        # Verify session_id is a valid UUID format (36 characters)
        assert len(event_data["session_id"]) == 36


def test_malformed_json_to_messages(mock_neo4j_driver):
    """Test that malformed JSON requests to messages endpoint return 422."""
    response = client.post(
        "/messages", data="not valid json", headers={"Content-Type": "application/json"}
    )
    assert response.status_code == 422


def test_wrong_method_on_sse(mock_neo4j_driver):
    """Test that POST to SSE endpoint returns 405 Method Not Allowed."""
    response = client.post("/sse")
    assert response.status_code == 405


def test_messages_get_not_allowed(mock_neo4j_driver):
    """Test that GET to messages endpoint returns 405."""
    response = client.get("/messages")
    assert response.status_code == 405
