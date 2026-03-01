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
        # Check for ${VAR} or ${VAR:-default} syntax
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
    
    assert neo4j_auth_line is not None, "neo4j service should have NEO4J_AUTH configured"
    assert "${NEO4J_PASSWORD" in neo4j_auth_line, \
        "NEO4J_AUTH should use NEO4J_PASSWORD environment variable substitution"


def test_docker_compose_uses_env_file():
    """Verify docker-compose.yml loads environment variables from .env file."""
    root = Path(__file__).parent.parent
    docker_compose_path = root / "docker-compose.yml"
    
    with open(docker_compose_path, 'r') as f:
        content = f.read()
    
    # Docker Compose automatically loads .env file if present
    # Verify configuration supports this via variable substitution
    env_vars = [
        "NEO4J_URI",
        "NEO4J_USER",
        "NEO4J_PASSWORD",
        "OPENAI_API_KEY",
        "ANTHROPIC_API_KEY",
        "FIRECRAWL_API_KEY",
        "MCP_SERVER_PORT",
        "LOG_LEVEL",
    ]
    
    for var in env_vars:
        # Each variable should use ${VAR} or ${VAR:-default} syntax
        # which allows values to be loaded from .env file
        assert f"${{{var}" in content, \
            f"docker-compose.yml should reference {var} with substitution syntax for .env loading"


def test_docker_compose_no_hardcoded_secrets():
    """Verify that no secrets are hardcoded in docker-compose.yml."""
    root = Path(__file__).parent.parent
    docker_compose_path = root / "docker-compose.yml"
    
    with open(docker_compose_path, 'r') as f:
        content = f.read()
    
    # Ensure API keys use substitution and are not hardcoded
    # Look for patterns that suggest hardcoded values (not starting with $)
    lines = content.split('\n')
    for line in lines:
        stripped = line.strip()
        
        # Check for API key patterns that don't use substitution
        if 'OPENAI_API_KEY:' in stripped and '${OPENAI_API_KEY' not in stripped:
            # Allow empty values or explicit null
            if stripped.split(':', 1)[1].strip() not in ['', 'null', '~']:
                assert False, "OPENAI_API_KEY should use environment variable substitution"
        
        if 'ANTHROPIC_API_KEY:' in stripped and '${ANTHROPIC_API_KEY' not in stripped:
            if stripped.split(':', 1)[1].strip() not in ['', 'null', '~']:
                assert False, "ANTHROPIC_API_KEY should use environment variable substitution"
        
        if 'FIRECRAWL_API_KEY:' in stripped and '${FIRECRAWL_API_KEY' not in stripped:
            if stripped.split(':', 1)[1].strip() not in ['', 'null', '~']:
                assert False, "FIRECRAWL_API_KEY should use environment variable substitution"


def test_env_file_exists_or_is_documented():
    """Verify that .env.example exists to document required environment variables."""
    root = Path(__file__).parent.parent
    
    # .env.example should exist as a template
    env_example = root / ".env.example"
    assert env_example.exists(), ".env.example should exist to document environment variables"
    
    # Verify it contains key variables
    with open(env_example, 'r') as f:
        content = f.read()
    
    required_vars = [
        "NEO4J_URI",
        "NEO4J_USER",
        "NEO4J_PASSWORD",
    ]
    
    for var in required_vars:
        assert var in content, f".env.example should document {var}"
