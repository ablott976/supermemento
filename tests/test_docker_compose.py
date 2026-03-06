"""Tests for docker-compose.yml configuration."""

import subprocess
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


@pytest.mark.skipif(not _has_docker_compose(), reason="docker-compose not available")
def test_docker_compose_config_validation() -> None:
    """Run docker-compose config to validate file format."""
    compose_file = _get_compose_file()
    project_root = compose_file.parent

    result = subprocess.run(
        ["docker-compose", "-f", str(compose_file), "config"],
        capture_output=True,
        text=True,
        cwd=str(project_root),
    )

    assert result.returncode == 0, (
        f"docker-compose config validation failed:\n"
        f"stdout: {result.stdout}\n"
        f"stderr: {result.stderr}"
    )

    # Verify port 8080 is in the rendered config
    assert "8080" in result.stdout, (
        "Port 8080 not found in docker-compose config output"
    )
