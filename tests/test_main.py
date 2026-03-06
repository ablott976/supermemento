"""Tests for main module."""

import socket
import threading
import time
from contextlib import closing

import pytest

from app.main import process_data, run_server


def find_free_port() -> int:
    """Find a free port on localhost."""
    with closing(socket.socket(socket.AF_INET, socket.SOCK_STREAM)) as s:
        s.bind(("", 0))
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        return s.getsockname()[1]


def test_process_data() -> None:
    """Test process_data function."""
    assert process_data([1, 2, 3]) == [2, 4, 6]
    assert process_data([]) == []
    assert process_data([-1, 0, 1]) == [-2, 0, 2]


def test_process_data_with_negative() -> None:
    """Test process_data with negative numbers."""
    result = process_data([-5, -10])
    assert result == [-10, -20]


class TestServerReachable:
    """Tests for server reachability on port 8080."""

    @pytest.fixture
    def server_port(self) -> int:
        """Get a free port for testing."""
        return find_free_port()

    @pytest.fixture
    def running_server(self, server_port: int) -> int:
        """Start server in background thread."""
        server_thread = threading.Thread(
            target=run_server,
            args=(server_port,),
            daemon=True,
        )
        server_thread.start()
        # Wait for server to start
        time.sleep(0.5)
        yield server_port
        # Cleanup happens automatically with daemon thread

    def test_server_reachable_on_port(self, running_server: int) -> None:
        """Test that server is reachable on configured port."""
        httpx = pytest.importorskip("httpx", reason="httpx required for HTTP tests")

        port = running_server
        try:
            with httpx.Client(timeout=5.0) as client:
                response = client.get(f"http://localhost:{port}/health")
                assert response.status_code in (200, 503)
        except httpx.ConnectError:
            pytest.fail(f"Server not reachable on port {port}")

    def test_health_endpoint_returns_200_when_reachable(
        self, running_server: int
    ) -> None:
        """Test health endpoint returns response when server is reachable."""
        httpx = pytest.importorskip("httpx", reason="httpx required for HTTP tests")

        port = running_server
        try:
            with httpx.Client(timeout=5.0) as client:
                response = client.get(f"http://localhost:{port}/health")
                # Should get a valid response (200 if Neo4j up, 503 if not)
                assert response.status_code in (200, 503)
                data = response.json()
                assert "status" in data
                assert data["status"] in ("healthy", "unhealthy")
        except httpx.ConnectError:
            pytest.fail(f"Server not reachable on port {port}")

    def test_sse_endpoint_accessible_when_reachable(self, running_server: int) -> None:
        """Test SSE endpoint is accessible when server is reachable."""
        httpx = pytest.importorskip("httpx", reason="httpx required for HTTP tests")

        port = running_server
        try:
            with httpx.Client(timeout=5.0) as client:
                response = client.get(f"http://localhost:{port}/sse")
                assert response.status_code == 200
                content_type = response.headers.get("content-type", "")
                assert "text/event-stream" in content_type
        except httpx.ConnectError:
            pytest.fail(f"Server not reachable on port {port}")


def test_server_starts_on_port_8080_and_is_reachable() -> None:
    """Test server can be started on port 8080 and is reachable."""
    httpx = pytest.importorskip("httpx", reason="httpx required for HTTP tests")

    port = 8080

    # Check if port is available
    with closing(socket.socket(socket.AF_INET, socket.SOCK_STREAM)) as s:
        if s.connect_ex(("localhost", port)) == 0:
            pytest.skip(f"Port {port} is already in use")

    # Start server in thread
    server_thread = threading.Thread(
        target=run_server,
        args=(port,),
        daemon=True,
    )
    server_thread.start()
    time.sleep(0.5)

    # Verify server is reachable on port 8080
    try:
        with httpx.Client(timeout=5.0) as client:
            response = client.get(f"http://localhost:{port}/health")
            # Should get a valid HTTP response
            assert response.status_code in (200, 503)
    except httpx.ConnectError as e:
        pytest.fail(f"Server should be reachable on port {port}, but got: {e}")


def test_server_reachable_scenario_with_sse_connection() -> None:
    """Test server is reachable and SSE endpoint accepts connections."""
    httpx = pytest.importorskip("httpx", reason="httpx required for HTTP tests")

    port = find_free_port()

    # Start server
    server_thread = threading.Thread(
        target=run_server,
        args=(port,),
        daemon=True,
    )
    server_thread.start()
    time.sleep(0.5)

    # Test that server is reachable and streams SSE
    try:
        with httpx.Client(timeout=5.0) as client:
            with client.stream("GET", f"http://localhost:{port}/sse") as response:
                assert response.status_code == 200
                # Try to read initial data
                data = response.read(10)
                assert len(data) > 0
    except httpx.ConnectError as e:
        pytest.fail(f"Server not reachable on port {port}: {e}")
