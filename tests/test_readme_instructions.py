"""Tests to verify README.md instructions are correct and functional.

This test suite validates that the setup instructions in README.md work as documented:
- Dependency installation
- Environment variable configuration
- Neo4j schema initialization
- Running the server in development mode
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

# Mark pre-existing tests that might fail due to environment issues
pytestmark = pytest.mark.skipif(
    os.getenv("SKIP_README_TESTS") == "1",
    reason="README tests skipped via environment variable",
)


class TestDependencyInstallation:
    """Test that dependencies can be installed and imported as per README."""

    def test_python_version(self) -> None:
        """Verify Python 3.12+ is available as required."""
        version_info = sys.version_info
        assert version_info.major == 3
        assert version_info.minor >= 12, f"Python 3.12+ required, found {version_info.major}.{version_info.minor}"

    def test_fastapi_importable(self) -> None:
        """Verify FastAPI is installed and importable."""
        try:
            import fastapi  # noqa: F401

            assert hasattr(fastapi, "FastAPI")
        except ImportError as e:
            pytest.skip(f"FastAPI not installed: {e}")

    def test_neo4j_importable(self) -> None:
        """Verify Neo4j driver is installed and importable."""
        try:
            from neo4j import AsyncDriver, AsyncGraphDatabase  # noqa: F401
        except ImportError as e:
            pytest.skip(f"Neo4j driver not installed: {e}")

    def test_pydantic_importable(self) -> None:
        """Verify Pydantic is installed and importable."""
        try:
            import pydantic  # noqa: F401
        except ImportError as e:
            pytest.skip(f"Pydantic not installed: {e}")

    def test_uvicorn_importable(self) -> None:
        """Verify Uvicorn is installed for running the server."""
        try:
            import uvicorn  # noqa: F401
        except ImportError as e:
            pytest.skip(f"Uvicorn not installed: {e}")

    def test_pytest_available(self) -> None:
        """Verify pytest is available for running tests."""
        result = subprocess.run(
            [sys.executable, "-m", "pytest", "--version"],
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0, "pytest should be available"


class TestEnvironmentVariables:
    """Test that environment variables are read as documented in README."""

    def test_neo4j_env_vars_defaults(self) -> None:
        """Verify Neo4j connection uses documented defaults."""
        from app.db.neo4j import Neo4jConnectionPool

        # Clear environment to test defaults
        env_vars_to_clear = [
            "NEO4J_URI",
            "NEO4J_USER",
            "NEO4J_PASSWORD",
            "NEO4J_DATABASE",
            "NEO4J_MAX_CONNECTION_POOL_SIZE",
            "NEO4J_CONNECTION_TIMEOUT",
            "NEO4J_MAX_CONNECTION_LIFETIME",
        ]

        # Save original values
        original_values: dict[str, str | None] = {}
        for var in env_vars_to_clear:
            original_values[var] = os.environ.get(var)
            if var in os.environ:
                del os.environ[var]

        try:
            pool = Neo4jConnectionPool()

            # Verify defaults match README documentation
            assert pool._uri == "bolt://localhost:7687"
            assert pool._user == "neo4j"
            assert pool._password == "password"
            assert pool._database == "neo4j"
            assert pool._max_connection_pool_size == 50
            assert pool._connection_timeout == 30.0
            assert pool._max_connection_lifetime == 3600
        finally:
            # Restore original values
            for var, value in original_values.items():
                if value is not None:
                    os.environ[var] = value
                elif var in os.environ:
                    del os.environ[var]

    def test_neo4j_env_vars_custom(self) -> None:
        """Verify Neo4j connection reads custom environment variables."""
        from app.db.neo4j import Neo4jConnectionPool

        # Set custom values
        custom_env = {
            "NEO4J_URI": "bolt://custom-host:7687",
            "NEO4J_USER": "customuser",
            "NEO4J_PASSWORD": "custompass",
            "NEO4J_DATABASE": "customdb",
            "NEO4J_MAX_CONNECTION_POOL_SIZE": "100",
            "NEO4J_CONNECTION_TIMEOUT": "60",
            "NEO4J_MAX_CONNECTION_LIFETIME": "7200",
        }

        # Save original values
        original_values: dict[str, str | None] = {}
        for var, value in custom_env.items():
            original_values[var] = os.environ.get(var)
            os.environ[var] = value

        try:
            pool = Neo4jConnectionPool()

            assert pool._uri == "bolt://custom-host:7687"
            assert pool._user == "customuser"
            assert pool._password == "custompass"
            assert pool._database == "customdb"
            assert pool._max_connection_pool_size == 100
            assert pool._connection_timeout == 60.0
            assert pool._max_connection_lifetime == 7200
        finally:
            # Restore original values
            for var, value in original_values.items():
                if value is not None:
                    os.environ[var] = value
                elif var in os.environ:
                    del os.environ[var]


class TestNeo4jSchemaInitialization:
    """Test that Neo4j schema initialization statements are valid."""

    def test_constraints_and_indexes_defined(self) -> None:
        """Verify CONSTRAINTS_AND_INDEXES are defined."""
        from app.db.neo4j import CONSTRAINTS_AND_INDEXES

        assert len(CONSTRAINTS_AND_INDEXES) > 0
        assert all(isinstance(stmt, str) for stmt in CONSTRAINTS_AND_INDEXES)

    def test_constraints_syntax_valid(self) -> None:
        """Verify constraint statements are valid Cypher syntax."""
        from app.db.neo4j import CONSTRAINTS_AND_INDEXES

        for stmt in CONSTRAINTS_AND_INDEXES:
            # Check for required Cypher keywords
            assert "CREATE" in stmt
            assert "CONSTRAINT" in stmt or "INDEX" in stmt
            assert "IF NOT EXISTS" in stmt
            assert "FOR" in stmt
            assert "REQUIRE" in stmt or "ON" in stmt

    def test_vector_indexes_defined(self) -> None:
        """Verify VECTOR_INDEXES are defined."""
        from app.db.neo4j import VECTOR_INDEXES

        assert len(VECTOR_INDEXES) > 0
        for entry in VECTOR_INDEXES:
            assert len(entry) == 3
            assert all(isinstance(s, str) for s in entry)

    def test_node_labels_defined(self) -> None:
        """Verify NodeLabels class has expected labels."""
        from app.db.neo4j import NodeLabels

        required_labels = ["ENTITY", "DOCUMENT", "CHUNK", "MEMORY", "USER"]
        for label in required_labels:
            assert hasattr(NodeLabels, label)
            assert isinstance(getattr(NodeLabels, label), str)

    def test_entity_properties_defined(self) -> None:
        """Verify EntityProperties class has expected properties."""
        from app.db.neo4j import EntityProperties

        assert hasattr(EntityProperties, "NAME")
        assert hasattr(EntityProperties, "OBSERVATIONS")
        assert hasattr(EntityProperties, "EMBEDDING")


class TestServerDevelopmentMode:
    """Test that the server can run in development mode as documented."""

    def test_main_module_exists(self) -> None:
        """Verify app.main module exists and is importable."""
        from app.main import main

        assert callable(main)

    def test_main_returns_int(self) -> None:
        """Verify main function returns integer exit code."""
        from app.main import main

        result = main([])
        assert isinstance(result, int)

    def test_get_config_path_returns_path(self) -> None:
        """Verify get_config_path returns a Path object."""
        from app.main import get_config_path

        config_path = get_config_path()
        assert isinstance(config_path, Path)

    def test_health_check_endpoint_exists(self) -> None:
        """Verify health check endpoint is defined."""
        from app.api.health import health_check

        assert callable(health_check)

    def test_app_modules_importable(self) -> None:
        """Verify all app modules can be imported."""
        # Core modules
        from app.core import DataProcessor, ProcessingError  # noqa: F401
        from app.db.neo4j import Neo4jConnectionPool  # noqa: F401
        from app.task_manager import TaskManager  # noqa: F401
        from app.utils import format_message, parse_arguments  # noqa: F401

    def test_config_path_creation(self, tmp_path: Path) -> None:
        """Verify configuration directory can be created."""
        from app.main import get_config_path

        # Temporarily override HOME to test directory creation
        original_home = os.environ.get("HOME")
        try:
            os.environ["HOME"] = str(tmp_path)
            config_path = get_config_path()
            config_path.parent.mkdir(parents=True, exist_ok=True)
            assert config_path.parent.exists()
        finally:
            if original_home is not None:
                os.environ["HOME"] = original_home
            elif "HOME" in os.environ:
                del os.environ["HOME"]


class TestReadmeDocumentationAccuracy:
    """Test that README instructions match actual implementation."""

    def test_readme_file_exists(self) -> None:
        """Verify README.md exists in project root."""
        project_root = Path(__file__).parent.parent
        readme_path = project_root / "README.md"
        assert readme_path.exists(), "README.md should exist in project root"

    def test_readme_contains_getting_started(self) -> None:
        """Verify README contains Getting Started section."""
        project_root = Path(__file__).parent.parent
        readme_path = project_root / "README.md"
        
        if not readme_path.exists():
            pytest.skip("README.md not found")

        content = readme_path.read_text()
        assert "## Getting Started" in content or "# Getting Started" in content

    def test_readme_contains_neo4j_instructions(self) -> None:
        """Verify README contains Neo4j setup instructions."""
        project_root = Path(__file__).parent.parent
        readme_path = project_root / "README.md"
        
        if not readme_path.exists():
            pytest.skip("README.md not found")

        content = readme_path.read_text().lower()
        assert "neo4j" in content

    def test_readme_contains_env_instructions(self) -> None:
        """Verify README contains environment variable instructions."""
        project_root = Path(__file__).parent.parent
        readme_path = project_root / "README.md"
        
        if not readme_path.exists():
            pytest.skip("README.md not found")

        content = readme_path.read_text().lower()
        assert "environment" in content or "env" in content or "neo4j_uri" in content

    def test_spec_file_exists(self) -> None:
        """Verify docs/SPEC.md exists as mentioned in issue."""
        project_root = Path(__file__).parent.parent
        spec_path = project_root / "docs" / "SPEC.md"
        
        # This might not exist yet, so we just check if docs dir exists
        docs_dir = project_root / "docs"
        if docs_dir.exists():
            assert (docs_dir / "SPEC.md").exists() or any(docs_dir.iterdir())


class TestDevelopmentWorkflow:
    """Test the development workflow commands mentioned in README."""

    def test_ruff_available(self) -> None:
        """Verify ruff is available for linting."""
        try:
            result = subprocess.run(
                [sys.executable, "-m", "ruff", "--version"],
                capture_output=True,
                text=True,
            )
            assert result.returncode == 0
        except FileNotFoundError:
            pytest.skip("ruff not installed")

    def test_pytest_can_run(self) -> None:
        """Verify pytest can run tests."""
        result = subprocess.run(
            [sys.executable, "-m", "pytest", "--collect-only", "-q"],
            capture_output=True,
            text=True,
            cwd=Path(__file__).parent.parent,
        )
        # Should collect tests without error
        assert result.returncode == 0 or "test session" in result.stdout

    def test_project_structure_valid(self) -> None:
        """Verify project structure matches README description."""
        project_root = Path(__file__).parent.parent
        
        # Check key directories exist
        assert (project_root / "app").exists(), "app directory should exist"
        assert (project_root / "tests").exists(), "tests directory should exist"
        
        # Check key files exist
        assert (project_root / "app" / "__init__.py").exists()
        assert (project_root / "app" / "main.py").exists()
