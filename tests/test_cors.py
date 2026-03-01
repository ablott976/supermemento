import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.mark.asyncio
async def test_cors_headers_present_on_response():
    """Test that CORS headers are present on regular responses."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/health")

        assert response.status_code == 200
        assert response.headers.get("access-control-allow-origin") == "*"
        assert response.headers.get("access-control-allow-credentials") == "true"


@pytest.mark.asyncio
async def test_cors_preflight_request():
    """Test that CORS preflight (OPTIONS) requests are handled correctly."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.options(
            "/health",
            headers={
                "Origin": "http://localhost:3000",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "Content-Type, Authorization",
            },
        )

        assert response.status_code == 200
        assert response.headers.get("access-control-allow-origin") == "*"
        assert response.headers.get("access-control-allow-methods") == "*"
        assert response.headers.get("access-control-allow-headers") == "*"
        assert response.headers.get("access-control-allow-credentials") == "true"


@pytest.mark.asyncio
async def test_cors_headers_with_specific_origin():
    """Test CORS headers when request includes a specific origin."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get(
            "/health",
            headers={"Origin": "http://localhost:3000"},
        )

        assert response.status_code == 200
        assert response.headers.get("access-control-allow-origin") == "*"
        assert "access-control-allow-methods" in response.headers
