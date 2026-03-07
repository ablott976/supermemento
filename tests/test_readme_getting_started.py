from __future__ import annotations

import json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
README_PATH = REPO_ROOT / "README.md"
ENV_EXAMPLE_PATH = REPO_ROOT / ".env.example"
PACKAGE_JSON_PATH = REPO_ROOT / "package.json"
DOCKER_COMPOSE_PATH = REPO_ROOT / "docker-compose.yml"
SPEC_PATH = REPO_ROOT / "docs" / "SPEC.md"


def _read(path: Path) -> str:
    """Read file contents as UTF-8 string."""
    return path.read_text(encoding="utf-8")


def test_readme_contains_getting_started_setup_flow() -> None:
    """Verify README contains the complete getting started workflow steps."""
    readme = _read(README_PATH)
    expected_steps = [
        "## Getting Started",
        "### 1. Install dependencies",
        "### 2. Configure environment variables",
        "### 3. Start Neo4j",
        "### 4. Initialize Neo4j schema",
        "### 5. Run the server in development mode",
    ]
    for step in expected_steps:
        assert step in readme, f"Missing documentation step: {step}"


def test_readme_commands_map_to_real_project_commands() -> None:
    """Verify README commands align with actual project scripts and tooling."""
    readme = _read(README_PATH)
    package_json = json.loads(_read(PACKAGE_JSON_PATH))
    scripts = package_json.get("scripts", {})

    assert "npm install" in readme
    assert "npm ci" in readme
    assert "docker compose up -d neo4j" in readme
    assert "npm run setup:schema" in readme
    assert "npm run dev" in readme

    # Verify scripts exist in package.json
    assert "setup:schema" in scripts, "setup:schema script not found in package.json"
    assert "dev" in scripts, "dev script not found in package.json"


def test_readme_environment_variables_are_defined_in_env_example() -> None:
    """Verify all environment variables mentioned in README exist in .env.example."""
    readme = _read(README_PATH)
    env_example = _read(ENV_EXAMPLE_PATH)
    expected_env_vars = [
        "NEO4J_URI",
        "NEO4J_USER",
        "NEO4J_PASSWORD",
        "OPENAI_API_KEY",
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_MODEL",
        "OPENAI_EMBEDDING_MODEL",
    ]
    for env_var in expected_env_vars:
        assert f"{env_var}=" in env_example, f"Variable {env_var} missing from .env.example"
        assert f"`{env_var}`" in readme, f"Variable {env_var} not properly referenced in README"


def test_readme_neo4j_setup_matches_docker_compose_service() -> None:
    """Verify Neo4j setup instructions in README match docker-compose configuration."""
    readme = _read(README_PATH)
    compose = _read(DOCKER_COMPOSE_PATH)

    assert "docker compose up -d neo4j" in readme, "Neo4j startup command not found in README"
    assert "neo4j:" in compose, "Neo4j service not found in docker-compose.yml"


def test_spec_references_readme_getting_started_for_local_setup() -> None:
    """Verify SPEC.md properly references README getting started section."""
    spec = _read(SPEC_PATH)

    assert "[Getting Started](../README.md#getting-started)" in spec
    assert "instalación de dependencias" in spec
    assert "variables de entorno" in spec
    assert "inicialización del schema de Neo4j" in spec
