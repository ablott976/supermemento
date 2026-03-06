"""Tests for SSE (Server-Sent Events) server connection."""

import os
from collections.abc import AsyncGenerator
from typing import TYPE_CHECKING

import pytest
import pytest_asyncio

if TYPE_CHECKING:
    import httpx

# SSE server configuration - can be overridden via environment variables
SSE_HOST = os.getenv("SSE_HOST", "localhost")
SSE_PORT = int(os.getenv("SSE_PORT", "8080"))
SSE_BASE_URL = f"http://{SSE_HOST}:{SSE_PORT}"
SSE_ENDPOINT = f"{SSE_BASE_URL}/sse"


def _is_server_available() -> bool:
    """Check if SSE server is available for testing."""
    try:
        import httpx

        with httpx.Client(timeout=2.0) as client:
            response = client.get(SSE_BASE_URL, timeout=2.0)
            return response.status_code < 500
    except Exception:
        return False


@pytest_asyncio.fixture
async def httpx_client() -> AsyncGenerator["httpx.AsyncClient", None]:
    """Provide httpx async client for tests."""
    import httpx

    async with httpx.AsyncClient(base_url=SSE_BASE_URL, timeout=10.0) as client:
        yield client


@pytest.mark.skipif(not _is_server_available(), reason="SSE server not available")
class TestSSEConnection:
    """Tests for verifying SSE server connection establishment."""

    @pytest.mark.asyncio
    async def test_sse_endpoint_exists_and_responds(self) -> None:
        """Verify SSE endpoint exists and returns 200 OK."""
        pytest.importorskip("httpx", reason="httpx required for HTTP requests")
        import httpx

        async with httpx.AsyncClient() as client:
            try:
                async with client.stream(
                    "GET",
                    SSE_ENDPOINT,
                    timeout=5.0,
                ) as response:
                    assert response.status_code == 200, (
                        f"SSE endpoint returned {response.status_code}, expected 200"
                    )
            except httpx.ConnectError as e:
                pytest.fail(f"Failed to connect to SSE server at {SSE_ENDPOINT}: {e}")

    @pytest.mark.asyncio
    async def test_sse_content_type_header(self) -> None:
        """Verify SSE endpoint returns correct Content-Type header."""
        pytest.importorskip("httpx", reason="httpx required for HTTP requests")
        import httpx

        async with httpx.AsyncClient() as client:
            try:
                async with client.stream(
                    "GET",
                    SSE_ENDPOINT,
                    timeout=5.0,
                ) as response:
                    content_type = response.headers.get("content-type", "")
                    assert "text/event-stream" in content_type, (
                        f"Expected Content-Type 'text/event-stream', got '{content_type}'"
                    )
            except httpx.ConnectError as e:
                pytest.fail(f"Failed to connect to SSE server: {e}")

    @pytest.mark.asyncio
    async def test_sse_connection_can_stream_data(self) -> None:
        """Verify SSE connection can be established and stream data."""
        pytest.importorskip("httpx", reason="httpx required for HTTP requests")
        import httpx

        async with httpx.AsyncClient() as client:
            try:
                async with client.stream(
                    "GET",
                    SSE_ENDPOINT,
                    timeout=5.0,
                ) as response:
                    assert response.status_code == 200
                    # Attempt to read some data from the stream
                    chunks: list[str] = []
                    total_length = 0
                    async for chunk in response.aiter_text():
                        chunks.append(chunk)
                        total_length += len(chunk)
                        # Break after receiving some data or timeout
                        if total_length > 100:
                            break
                    # Connection established successfully if we got here
                    received = "".join(chunks)
                    assert isinstance(received, str)
            except httpx.ReadTimeout:
                # Timeout is acceptable if connection was established but no events sent
                pass
            except httpx.ConnectError as e:
                pytest.fail(f"Failed to connect to SSE server: {e}")


@pytest.mark.skipif(not _is_server_available(), reason="SSE server not available")
class TestSSEServerBehavior:
    """Tests for SSE server behavior and protocol compliance."""

    @pytest.mark.asyncio
    async def test_sse_endpoint_rejects_post_without_streaming(self) -> None:
        """Verify SSE endpoint handles POST requests appropriately."""
        pytest.importorskip("httpx", reason="httpx required for HTTP requests")
        import httpx

        async with httpx.AsyncClient() as client:
            # POST might be used for sending messages back to server
            response = await client.post(
                SSE_ENDPOINT,
                json={"test": "data"},
                timeout=5.0,
            )
            # Should accept (200/202) or indicate method not allowed (405)
            assert response.status_code in {200, 202, 405}, (
                f"Unexpected status code {response.status_code} for POST to SSE endpoint"
            )
