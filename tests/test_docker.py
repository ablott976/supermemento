import subprocess
from pathlib import Path

def test_docker_compose_valid():
    """Verify that docker-compose.yml is valid."""
    root = Path(__file__).parent.parent
    result = subprocess.run(
        ["docker", "compose", "config", "-q"],
        cwd=root,
        capture_output=True,
        text=True
    )
    assert result.returncode == 0, f"docker-compose.yml is invalid: {result.stderr}"

def test_dockerfile_buildable():
    """Verify that Dockerfile exists and can be parsed."""
    root = Path(__file__).parent.parent
    dockerfile_path = root / "Dockerfile"
    assert dockerfile_path.exists(), "Dockerfile is missing"
