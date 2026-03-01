"""Tests for security-related configurations including CORS middleware."""

import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_cors_headers_present_on_get_request(mock_neo4j_driver):
    """Verify CORS headers are present in GET responses."""
    response = client.get("/health", headers={"Origin": "http://example.com"})
    assert response.status_code == 200
    assert "access-control-allow-origin" in response.headers
    assert response.headers["access-control-allow-origin"] == "*"


def test_cors_preflight_request(mock_neo4j_driver):
    """Verify CORS preflight (OPTIONS) requests are handled correctly."""
    response = client.options(
        "/health",
        headers={
            "Origin": "http://example.com",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "Content-Type",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "*"
    assert response.headers["access-control-allow-credentials"] == "true"
    # Should allow all methods
    assert "*" in response.headers["access-control-allow-methods"] or "GET" in response.headers["access-control-allow-methods"]
    # Should allow Content-Type header
    assert "content-type" in response.headers.get("access-control-allow-headers", "").lower() or "*" in response.headers.get("access-control-allow-headers", "")


def test_cors_allows_any_origin(mock_neo4j_driver):
    """Verify that any origin is allowed (allow_origins=['*'])."""
    origins = [
        "http://localhost:3000",
        "http://localhost:8080",
        "https://example.com",
        "https://app.example.com",
        "http://127.0.0.1:5500",
    ]
    
    for origin in origins:
        response = client.get("/health", headers={"Origin": origin})
        assert response.status_code == 200
        assert response.headers["access-control-allow-origin"] == "*"


def test_cors_allows_credentials(mock_neo4j_driver):
    """Verify that credentials are allowed in CORS requests."""
    response = client.get(
        "/health",
        headers={
            "Origin": "http://example.com",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-credentials"] == "true"


def test_cors_on_post_request(mock_neo4j_driver):
    """Verify CORS headers are present on POST responses (for non-preflight)."""
    response = client.post(
        "/messages",
        json={"test": "data"},
        headers={
            "Origin": "http://example.com",
            "Content-Type": "application/json",
        },
    )
    # Even if the endpoint returns 422 (malformed MCP message), CORS headers should be present
    assert response.headers.get("access-control-allow-origin") == "*"


def test_cors_preflight_allows_custom_headers(mock_neo4j_driver):
    """Verify that custom headers are allowed via preflight."""
    response = client.options(
        "/messages",
        headers={
            "Origin": "http://example.com",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "X-Custom-Header, Authorization",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "*"
    # Headers should be allowed (either explicitly or via wildcard)
    allow_headers = response.headers.get("access-control-allow-headers", "").lower()
    assert "*" in allow_headers or "x-custom-header" in allow_headers or "authorization" in allow_headers
