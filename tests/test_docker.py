"""Tests for docker-compose up functionality and exposed ports."""

import socket
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


def _get_project_root() -> Path:
    """Get project root directory."""
    return Path(__file__).parent.parent


@pytest.mark.skipif(not _has_docker_compose(), reason="docker-compose not available")
class TestDockerComposeUp:
    """Tests for verifying docker-compose up with exposed port."""

    @pytest.fixture(scope="class")
    def docker_compose_up(self) -> None:
        """Start docker-compose services and cleanup after tests."""
        compose_file = _get_compose_file()
        project_root = _get_project_root()

        # Start services
        up_result = subprocess.run(
            ["docker-compose", "-f", str(compose_file), "up", "-d"],
            capture_output=True,
            text=True,
            cwd=str(project_root),
        )
        if up_result
