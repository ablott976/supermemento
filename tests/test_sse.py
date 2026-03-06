"""Tests for SSE server connection behavior."""

import socket
import threading
import time
from contextlib import closing

import pytest

from app.main import run_server


def _find_free_port() -> int:
    """Return an available local TCP port."""
    with closing(socket.socket(socket.AF_INET, socket.SOCK_STREAM)) as sock:
        sock.bind(("", 0))
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        return int(sock.getsockname()[1])


@pytest.fixture
def running_sse_server() -> int:
    """Start the server and wait until its socket is reachable."""
    port = _find_free_port()
    server_thread = threading.Thread(target=run_server, args=(port,), daemon=True)
    server_thread.start()

    deadline = time.time() + 5
    while time.time() < deadline:
        try:
            with socket.create_connection(("localhost", port), timeout=0.2):
                return port
        except OSError:
            time.sleep(0.05)
    pytest.fail(f"SSE test server did not become reachable on port {port}")


class TestSSEServerConnection:
    """Connection-level checks for the SSE endpoint."""

    def test_sse_server_accepts_tcp_connections(self, running_sse_server: int) -> None:
        """Verify host can establish a TCP connection to the server port."""
        with socket.create_connection(
            ("localhost", running_sse_server), timeout=5
        ) as sock:
            assert sock.fileno() > 0

    def test_sse_endpoint_returns_event_stream_headers(
        self, running_sse_server: int
    ) -> None:
        """Verify /sse returns an SSE content type and success status."""
        httpx = pytest.importorskip("httpx", reason="httpx required for HTTP tests")

        with httpx.Client(timeout=5.0) as client:
            with client.stream(
                "GET", f"http://localhost:{running_sse_server}/sse"
            ) as response:
                assert response.status_code == 200
                assert "text/event-stream" in response.headers.get("content-type", "")

    def test_sse_endpoint_sends_initial_stream_bytes(
        self, running_sse_server: int
    ) -> None:
        """Verify /sse sends initial bytes after connection establishment."""
        httpx = pytest.importorskip("httpx", reason="httpx required for HTTP tests")

        with httpx.Client(timeout=5.0) as client:
            with client.stream(
                "GET", f"http://localhost:{running_sse_server}/sse"
            ) as response:
                assert response.status_code == 200
                first_chunk = response.read(32)
                assert first_chunk != b""
                assert b":ok" in first_chunk
