from __future__ import annotations

import json
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
README_PATH = REPO_ROOT / "README.md"
ENV_EXAMPLE_PATH = REPO_ROOT / ".env.example"
PACKAGE_JSON_PATH = REPO_ROOT / "package.json"
DOCKER_COMPOSE_PATH = REPO_ROOT / "docker-compose.yml"


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def test_readme_contains_getting_started_setup_flow() -> None:
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
        assert step in readme


def test_readme_commands_map_to_real_project_commands() -> None:
    readme = _read(README_PATH)
    package_json = json.loads(_read(PACKAGE_JSON_PATH))
    scripts = package_json.get("scripts", {})

    assert "npm install" in readme
    assert "npm ci" in readme
    assert "docker compose up -d neo4j" in readme
    assert "npm run setup:schema" in readme
    assert "npm run dev" in readme

    assert "setup:schema" in scripts
    assert "dev" in scripts


def test_readme_environment_variables_are_defined_in_env_example() -> None:
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
        assert f"{env_var}=" in env_example
        assert f"`{env_var}`" in readme


def test_readme_neo4j_setup_matches_docker_compose_service() -> None:
    readme = _read(README_PATH)
    compose = _read(DOCKER_COMPOSE_PATH)

    assert "docker compose up -d neo4j" in readme
    assert "neo4j:" in compose
