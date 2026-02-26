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

def test_docker_ignore_presence():
    """Verify that .dockerignore exists and contains common patterns."""
    root = Path(__file__).parent.parent
    docker_ignore_path = root / ".dockerignore"
    assert docker_ignore_path.exists(), ".dockerignore is missing"
    
    with open(docker_ignore_path, 'r') as f:
        content = f.read()
        assert ".git" in content
        assert "__pycache__" in content
        assert ".venv" in content
        assert ".env" in content

def test_docker_compose_services_details():
    """Verify specific configuration of services in docker-compose.yml."""
    root = Path(__file__).parent.parent
    docker_compose_path = root / "docker-compose.yml"
    
    with open(docker_compose_path, 'r') as f:
        content = f.read()
        # Verify app service details
        assert "build: ." in content
        assert "8000:8000" in content
        assert "NEO4J_URI=bolt://neo4j:7687" in content
        assert "OPENAI_API_KEY=${OPENAI_API_KEY:-}" in content
        
        # Verify neo4j service details
        assert "image: neo4j:5" in content
        assert "7474:7474" in content  # HTTP
        assert "7687:7687" in content  # Bolt
