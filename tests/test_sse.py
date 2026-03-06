"""Tests for SSE server connection behavior."""

import http.client
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
    """Start the app server and wait until the socket is reachable."""
    port = _find_free_port()
    server_thread = threading.Thread(target=run_server, args=(port,), daemon=True)
    server_thread.start()

    deadline = time.time() + 5
    while time.time() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                return port
        except OSError:
            time.sleep(0.05)

    pytest.fail(f"SSE test server did not become reachable on port {port}")


def test_sse_server_accepts_tcp_connections(running_sse_server: int) -> None:
    """Verify host can establish a TCP connection to the SSE server port."""
    with socket.create_connection(("127.0.0.1", running_sse_server), timeout=5) as sock:
        assert sock.fileno() > 0


def test_sse_endpoint_returns_event_stream_headers(running_sse_server: int) -> None:
    """Verify /sse responds with success status and SSE content type."""
    conn = http.client.HTTPConnection("127.0.0.1", running_sse_server, timeout=5)
    try:
        conn.request("GET", "/sse")
        response = conn.getresponse()
        assert response.status == 200
        assert "text/event-stream" in response.getheader("Content-Type", "")
    finally:
        conn.close()


def test_sse_endpoint_sends_initial_stream_bytes(running_sse_server: int) -> None:
    """Verify /sse sends the initial stream payload after connect."""
    conn = http.client.HTTPConnection("127.0.0.1", running_sse_server, timeout=5)
    try:
        conn.request("GET", "/sse")
        response = conn.getresponse()
        assert response.status == 200

        first_chunk = response.read(5)
        assert first_chunk == b":ok\n\n"
    finally:
        conn.close()


def test_sse_connection_refused_when_server_unreachable() -> None:
    """Verify connecting to an unused port fails with connection refusal."""
    port = _find_free_port()

    with pytest.raises(OSError):
        with socket.create_connection(("127.0.0.1", port), timeout=0.2):
            pass


@pytest.fixture
def unresponsive_tcp_server() -> int:
    """Start a server that accepts one connection and never responds."""
    ready = threading.Event()
    stop = threading.Event()
    server_info: dict[str, int] = {}

    def _run() -> None:
        with closing(socket.socket(socket.AF_INET, socket.SOCK_STREAM)) as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            sock.bind(("127.0.0.1", 0))
            sock.listen(1)
            server_info["port"] = int(sock.getsockname()[1])
            ready.set()

            conn, _ = sock.accept()
            with conn:
                stop.wait(timeout=2)

    thread = threading.Thread(target=_run, daemon=True)
    thread.start()
    assert ready.wait(timeout=2), "Unresponsive TCP server did not start"
    yield server_info["port"]
    stop.set()
    thread.join(timeout=2)


def test_sse_connection_times_out_when_server_stalls(
    unresponsive_tcp_server: int,
) -> None:
    """Verify SSE request times out if peer accepts but never replies."""
    conn = http.client.HTTPConnection("127.0.0.1", unresponsive_tcp_server, timeout=0.2)
    try:
        conn.request("GET", "/sse")
        with pytest.raises((TimeoutError, socket.timeout)):
            conn.getresponse()
    finally:
        conn.close()
