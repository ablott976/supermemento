"""Docker compose tests for SSE port exposure."""

import socket
import subprocess
import time
from pathlib import Path

import pytest


def _compose_file() -> Path:
    return Path(__file__).parent.parent / "docker-compose.yml"


def _has_compose_and_docker() -> bool:
    try:
        compose_ok = subprocess.run(
            ["docker-compose", "--version"],
            capture_output=True,
            timeout=5,
            check=False,
        ).returncode == 0
        if not compose_ok:
            return False
        return (
            subprocess.run(
                ["docker", "info"],
                capture_output=True,
                timeout=10,
                check=False,
            ).returncode
            == 0
        )
    except (FileNotFoundError, subprocess.SubprocessError):
        return False


def test_compose_defines_mcp_server_port_8080_mapping() -> None:
    """Verify compose publishes mcp-server 8080 to host 8080."""
    yaml = pytest.importorskip("yaml", reason="PyYAML not installed")
    with _compose_file().open(encoding="utf-8") as compose:
        config = yaml.safe_load(compose)

    mcp_server = config["services"]["mcp-server"]
    ports = [str(port) for port in mcp_server.get("ports", [])]
    assert "8080:8080" in ports


@pytest.mark.skipif(
    not _has_compose_and_docker(), reason="docker-compose/docker daemon unavailable"
)
@pytest.mark.integration
def test_docker_compose_up_exposes_port_8080() -> None:
    """Bring services up and assert localhost:8080 becomes reachable."""
    compose_file = _compose_file()
    result = subprocess.run(
        ["docker-compose", "-f", str(compose_file), "up", "-d", "--build"],
        capture_output=True,
        text=True,
        timeout=180,
        check=False,
    )
    assert result.returncode == 0, result.stderr

    try:
        for _ in range(60):
            try:
                with socket.create_connection(("127.0.0.1", 8080), timeout=1):
                    return
            except (ConnectionRefusedError, OSError, socket.timeout):
                time.sleep(1)
        pytest.fail("mcp-server never became reachable on localhost:8080")
    finally:
        subprocess.run(
            ["docker-compose", "-f", str(compose_file), "down", "-v"],
            capture_output=True,
            timeout=120,
            check=False,
        )
