"""Tests for docker-compose.yml configuration."""

import subprocess
import time
from pathlib import Path

import pytest


def _has_docker_compose() -> bool:
    """Check if docker-compose command is available."""
    try:
        result = subprocess.run(
            ["docker-compose", "--version"],
            capture_output=True,
            timeout=5,
        )
        return result.returncode == 0
    except (subprocess.SubprocessError, FileNotFoundError):
        return False


def _get_compose_file() -> Path:
    """Get path to docker-compose.yml."""
    return Path(__file__).parent.parent / "docker-compose.yml"


def test_docker_compose_file_exists() -> None:
    """Verify docker-compose.yml exists in project root."""
    compose_file = _get_compose_file()
    assert compose_file.exists(), "docker-compose.yml not found in project root"


def test_docker_compose_yaml_syntax() -> None:
    """Verify docker-compose.yml is valid YAML."""
    pytest.importorskip("yaml", reason="PyYAML not installed")
    import yaml

    compose_file = _get_compose_file()
    with open(compose_file) as f:
        try:
            config = yaml.safe_load(f)
        except yaml.YAMLError as e:
            pytest.fail(f"Invalid YAML syntax in docker-compose.yml: {e}")
    assert isinstance(config, dict), "docker-compose.yml should be a YAML mapping"
    assert "services" in config, "docker-compose.yml must define services"


def test_mcp_server_service_exists() -> None:
    """Verify mcp-server service is defined."""
    pytest.importorskip("yaml", reason="PyYAML not installed")
    import yaml

    compose_file = _get_compose_file()
    with open(compose_file) as f:
        config = yaml.safe_load(f)
    services = config.get("services", {})
    assert "mcp-server" in services, "mcp-server service must be defined"


def test_mcp_server_has_image_or_build() -> None:
    """Verify mcp-server has either image or build configuration."""
    pytest.importorskip("yaml", reason="PyYAML not installed")
    import yaml

    compose_file = _get_compose_file()
    with open(compose_file) as f:
        config = yaml.safe_load(f)
    mcp_server = config["services"]["mcp-server"]
    has_image = "image" in mcp_server
    has_build = "build" in mcp_server
    assert has_image or has_build, "mcp-server must define either 'image' or 'build'"


def test_mcp_server_port_8080_exposed() -> None:
    """Verify mcp-server exposes port 8080 for SSE transport."""
    pytest.importorskip("yaml", reason="PyYAML not installed")
    import yaml

    compose_file = _get_compose_file()
    with open(compose_file) as f:
        config = yaml.safe_load(f)
    mcp_server = config["services"]["mcp-server"]
    ports = mcp_server.get("ports", [])
    # Check for port 8080 exposure
    port_mappings = [str(p) for p in ports]
    has_port_8080 = any("8080:8080" in p or p == "8080" for p in port_mappings)
    assert has_port_8080, "mcp-server must expose port 8080:8080 for SSE transport"


def test_mcp_server_restart_policy() -> None:
    """Verify mcp-server has restart policy configured."""
    pytest.importorskip("yaml", reason="PyYAML not installed")
    import yaml

    compose_file = _get_compose_file()
    with open(compose_file) as f:
        config = yaml.safe_load(f)
    mcp_server = config["services"]["mcp-server"]
    restart = mcp_server.get("restart")
    assert restart is not None, "mcp-server should have a restart policy"
    assert restart in ["always", "unless-stopped", "on-failure"], (
        f"Invalid restart policy: {restart}"
    )


def test_mcp_server_health_check() -> None:
    """Verify mcp-server has health check configured."""
    pytest.importorskip("yaml", reason="PyYAML not installed")
    import yaml

    compose_file = _get_compose_file()
    with open(compose_file) as f:
        config = yaml.safe_load(f)
    mcp_server = config["services"]["mcp-server"]
    healthcheck = mcp_server.get("healthcheck")
    assert healthcheck is not None, "mcp-server should have a healthcheck"
    assert "test" in healthcheck, "healthcheck must have a test command"


def test_mcp_server_container_name() -> None:
    """Verify mcp-server has container name configured."""
    pytest.importorskip("yaml", reason="PyYAML not installed")
    import yaml

    compose_file = _get_compose_file()
    with open(compose_file) as f:
        config = yaml.safe_load(f)
    mcp_server = config["services"]["mcp-server"]
    container_name = mcp_server.get("container_name")
    assert container_name is not None, "mcp-server should have a container_name"
    assert container_name == "mcp-server", (
        f"container_name should be 'mcp-server', got '{container_name}'"
    )


def test_mcp_server_environment_port() -> None:
    """Verify mcp-server has PORT environment variable set to 8080."""
    pytest.importorskip("yaml", reason="PyYAML not installed")
    import yaml

    compose_file = _get_compose_file()
    with open(compose_file) as f:
        config = yaml.safe_load(f)
    mcp_server = config["services"]["mcp-server"]
    environment = mcp_server.get("environment", {})
    
    # Check if PORT is set to 8080
    port_value = None
    if isinstance(environment, dict):
        port_value = environment.get("PORT")
    elif isinstance(environment, list):
        for env in environment:
            if isinstance(env, str) and env.startswith("PORT="):
                port_value = env.split("=", 1)[1]
                break
    
    assert port_value == "8080", f"PORT should be set to 8080, got {port_value}"


@pytest.mark.skipif(not _has_docker_compose(), reason="docker-compose not available")
@pytest.mark.integration
class TestDockerComposeUp:
    """Integration tests that verify docker-compose deployment."""
    
    @pytest.fixture(scope="class")
    def docker_services(self):
        """Start docker-compose services and cleanup after tests."""
        compose_file = _get_compose_file()
        
        # Start services
        result = subprocess.run(
            ["docker-compose", "-f", str(compose_file), "up", "-d", "--build"],
            capture_output=True,
            text=True,
            timeout=120,
        )
        if result.returncode != 0:
            pytest.fail(f"Failed to start docker-compose: {result.stderr}")
        
        try:
            # Wait for port 8080 to be available
            import socket
            
            for _ in range(60):  # Wait up to 60 seconds
                try:
                    sock = socket.create_connection(("localhost", 8080), timeout=1)
                    sock.close()
                    break
                except (socket.timeout, ConnectionRefusedError, OSError):
                    time.sleep(1)
            else:
                raise RuntimeError("Server did not become available on port 8080")
            yield
        finally:
            # Cleanup
            subprocess.run(
                ["docker-compose", "-f", str(compose_file), "down", "-v"],
                capture_output=True,
                timeout=60,
            )
    
    def test_server_reachable_on_port_8080(self, docker_services) -> None:
        """Verify server is reachable on port 8080 after running docker-compose up."""
        import socket
        
        # Verify TCP connection can be established
        sock = socket.create_connection(("localhost", 8080), timeout=10)
        try:
            # Send HTTP GET request to verify HTTP server is responding
            sock.send(b"GET / HTTP/1.1\r\nHost: localhost:8080\r\nConnection: close\r\n\r\n")
            response = sock.recv(1024).decode("utf-8")
            # Should receive some HTTP response (might be 404 or 200, but not connection refused)
            assert "HTTP/1." in response, f"Expected HTTP response, got: {response}"
        finally:
            sock.close()
