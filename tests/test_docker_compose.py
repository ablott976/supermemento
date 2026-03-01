from pathlib import Path


def test_docker_compose_uses_env_substitution():
    """Verify docker-compose.yml uses environment variable substitution for configuration."""
    root = Path(__file__).parent.parent
    docker_compose_path = root / "docker-compose.yml"
    
    with open(docker_compose_path, 'r') as f:
        content = f.read()
    
    # Essential environment variables that should use substitution syntax
    required_substitutions = [
        "NEO4J_URI",
        "NEO4J_USER",
        "NEO4J_PASSWORD",
        "OPENAI_API_KEY",
        "ANTHROPIC_API_KEY",
    ]
    
    for var in required_substitutions:
        # Check for ${VAR} or ${VAR:-default} syntax pattern
        pattern = f"${{{var}"
        assert pattern in content, f"docker-compose.yml should use environment variable substitution for {var}"


def test_docker_compose_has_default_values():
    """Verify sensitive configuration has default values for development."""
    root = Path(__file__).parent.parent
    docker_compose_path = root / "docker-compose.yml"
    
    with open(docker_compose_path, 'r') as f:
        content = f.read()
    
    # Check that Neo4j credentials have defaults using :- syntax
    assert "${NEO4J_URI:-" in content, "NEO4J_URI should have a default value"
    assert "${NEO4J_USER:-" in content, "NEO4J_USER should have a default value"
    assert "${NEO4J_PASSWORD:-" in content, "NEO4J_PASSWORD should have a default value"
    
    # Port should have default
    assert "${MCP_SERVER_PORT:-" in content, "MCP_SERVER_PORT should have a default value"


def test_docker_compose_app_environment_section():
    """Verify the app service configures environment variables."""
    root = Path(__file__).parent.parent
    docker_compose_path = root / "docker-compose.yml"
    
    with open(docker_compose_path, 'r') as f:
        content = f.read()
    
    # Should have an environment section in the app service
    lines = content.split('\n')
    in_app_service = False
    env_section_found = False
    
    for line in lines:
        stripped = line.strip()
        if stripped == 'app:':
            in_app_service = True
        elif in_app_service and stripped and not line.startswith(' ') and not line.startswith('#'):
            # We've left the app service section
            break
        elif in_app_service and 'environment:' in line:
            env_section_found = True
            break
    
    assert env_section_found, "app service should have an environment section"


def test_docker_compose_neo4j_environment_section():
    """Verify the neo4j service configures environment variables."""
    root = Path(__file__).parent.parent
    docker_compose_path = root / "docker-compose.yml"
    
    with open(docker_compose_path, 'r') as f:
        content = f.read()
    
    # Neo4j should have NEO4J_AUTH configured with env substitution
    assert "NEO4J_AUTH" in content, "neo4j service should configure NEO4J_AUTH"


def test_neo4j_password_substitution_in_app_service():
    """Verify NEO4J_PASSWORD is properly substituted in the app service environment."""
    root = Path(__file__).parent.parent
    docker_compose_path = root / "docker-compose.yml"
    
    with open(docker_compose_path, 'r') as f:
        content = f.read()
    
    # Check that app service uses NEO4J_PASSWORD with substitution syntax
    # This validates the specific line: NEO4J_PASSWORD: ${NEO4J_PASSWORD:-password}
    assert "NEO4J_PASSWORD: ${NEO4J_PASSWORD" in content, \
        "app service should use NEO4J_PASSWORD environment variable substitution"


def test_neo4j_password_substitution_in_neo4j_auth():
    """Verify NEO4J_PASSWORD is substituted within NEO4J_AUTH for the neo4j service."""
    root = Path(__file__).parent.parent
    docker_compose_path = root / "docker-compose.yml"
    
    with open(docker_compose_path, 'r') as f:
        content = f.read()
    
    # NEO4J_AUTH should reference NEO4J_PASSWORD using substitution syntax
    # Common format: NEO4J_AUTH: ${NEO4J_USER:-neo4j}/${NEO4J_PASSWORD:-password}
    assert "NEO4J_AUTH" in content, "NEO4J_AUTH must be configured"
    
    # Verify NEO4J_PASSWORD is referenced in the content with substitution syntax
    assert "${NEO4J_PASSWORD" in content, \
        "NEO4J_PASSWORD should be referenced with environment variable substitution"
    
    # Check that the neo4j service section uses the password variable in NEO4J_AUTH
    lines = content.split('\n')
    in_neo4j_service = False
    neo4j_auth_line = None
    
    for line in lines:
        stripped = line.strip()
        if stripped == 'neo4j:':
            in_neo4j_service = True
        elif in_neo4j_service and stripped and not line.startswith(' ') and not line.startswith('#'):
            # We've left the neo4j service section
            break
        elif in_neo4j_service and 'NEO4J_AUTH' in line:
            neo4j_auth_line = line
            break
    
    assert neo4j_auth_line is not None, "neo4j service should have NEO4J_AUTH configuration"
    assert "${NEO4J_PASSWORD" in neo4j_auth_line, \
        "NEO4J_AUTH should use NEO4J_PASSWORD environment variable substitution"
