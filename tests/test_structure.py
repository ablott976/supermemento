from pathlib import Path

def test_project_structure():
    """Verify that all mandatory files are present in the project structure."""
    root = Path(__file__).parent.parent
    
    mandatory_files = [
        "pyproject.toml",
        "Dockerfile",
        "docker-compose.yml",
        ".env.example",
        ".gitignore",
        "app/config.py",
        "app/__init__.py",
        "app/main.py",
        "app/db/neo4j.py",
        "app/db/queries.py",
        "app/models/entity.py",
        "app/models/document.py",
        "app/models/chunk.py",
        "app/models/memory.py",
        "app/models/user.py",
    ]
    
    for file_path in mandatory_files:
        assert (root / file_path).exists(), f"Mandatory file {file_path} is missing"

def test_docker_config_ports():
    """Verify Docker configuration uses the correct ports."""
    root = Path(__file__).parent.parent
    docker_compose_path = root / "docker-compose.yml"
    dockerfile_path = root / "Dockerfile"
    
    # Check Dockerfile EXPOSE
    with open(dockerfile_path, 'r') as f:
        dockerfile_content = f.read()
        assert "EXPOSE 8000" in dockerfile_content
        
    # Check docker-compose ports
    with open(docker_compose_path, 'r') as f:
        docker_compose_content = f.read()
        assert '"8000:8000"' in docker_compose_content or "'8000:8000'" in docker_compose_content or "8000:8000" in docker_compose_content
