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

def test_env_example_content():
    """Verify that .env.example contains essential configuration keys."""
    root = Path(__file__).parent.parent
    env_example_path = root / ".env.example"
    
    with open(env_example_path, 'r') as f:
        content = f.read()
        essential_keys = [
            "NEO4J_URI",
            "NEO4J_USER",
            "NEO4J_PASSWORD",
            "OPENAI_API_KEY",
            "ANTHROPIC_API_KEY",
        ]
        for key in essential_keys:
            assert f"{key}=" in content

def test_docker_config_services():
    """Verify docker-compose.yml contains essential services."""
    root = Path(__file__).parent.parent
    docker_compose_path = root / "docker-compose.yml"
    
    with open(docker_compose_path, 'r') as f:
        content = f.read()
        assert "services:" in content
        assert "  app:" in content
        assert "  neo4j:" in content
        assert "depends_on:" in content
        assert "neo4j_data:" in content

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

def test_pyproject_dependencies():
    """Verify that essential dependencies are present in pyproject.toml."""
    root = Path(__file__).parent.parent
    pyproject_path = root / "pyproject.toml"
    
    with open(pyproject_path, 'r') as f:
        content = f.read()
        essential_deps = [
            "fastapi",
            "uvicorn",
            "neo4j",
            "pydantic",
            "pydantic-settings",
            "openai",
            "anthropic",
            "apscheduler",
            "httpx",
        ]
        for dep in essential_deps:
            assert dep in content

def test_dockerfile_stages():
    """Verify that Dockerfile uses a multi-stage build as per requirements."""
    root = Path(__file__).parent.parent
    dockerfile_path = root / "Dockerfile"
    
    with open(dockerfile_path, 'r') as f:
        content = f.read()
        # Look for multiple FROM statements which indicate multi-stage
        from_count = content.count("FROM ")
        assert from_count >= 2, "Dockerfile should use multi-stage build"
        assert "python:3.12" in content or "python:3.12-slim" in content
