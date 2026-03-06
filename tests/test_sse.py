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
    """Start the test server and return the listening port."""
    port = _find_free_port()
    server_thread = threading.Thread(target=run_server, args=(port,), daemon=True)
    server_thread.start()
    time.sleep(0.5)
    return port


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
        """Verify /sse responds with SSE content type and a success status."""
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

    def test_connection_refused_on_unused_port(self) -> None:
        """Verify connecting to an unused port raises connection-refused style errors."""
        unused_port = _find_free_port()

        with pytest.raises((ConnectionRefusedError, OSError)):
            socket.create_connection(("localhost", unused_port), timeout=0.2)

    def test_socket_read_times_out_when_peer_stalls(self) -> None:
        """Verify client times out when peer accepts but never sends data."""
        server_port = _find_free_port()
        ready = threading.Event()
        release = threading.Event()

        def _stalled_server() -> None:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as server:
                server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                server.bind(("localhost", server_port))
                server.listen(1)
                ready.set()
                conn, _ = server.accept()
                with conn:
                    release.wait(timeout=1.0)

        thread = threading.Thread(target=_stalled_server, daemon=True)
        thread.start()
        assert ready.wait(timeout=1.0), "stalled test server failed to start"

        try:
            with socket.create_connection(
                ("localhost", server_port), timeout=0.5
            ) as client:
                client.settimeout(0.1)
                with pytest.raises(socket.timeout):
                    _ = client.recv(1)
        finally:
            release.set()
            thread.join(timeout=1.0)
