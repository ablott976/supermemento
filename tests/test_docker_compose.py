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
    env = mcp_server.get("environment", {})

    # Check for PORT=8080 in either dict or list format
    if isinstance(env, dict):
        assert "PORT" in env, "mcp-server should have PORT environment variable"
        assert str(env["PORT"]) == "8080", "PORT should be set to 8080"
    elif isinstance(env, list):
        port_found = any(str(e) in ["PORT=8080", "PORT: '8080'"] for e in env)
        assert port_found, "mcp-server should have PORT=8080 environment variable"
    else:
        pytest.fail("environment should be a dict or list")


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
