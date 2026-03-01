import pytest
from unittest.mock import AsyncMock, MagicMock
from pathlib import Path


@pytest.fixture
def mock_neo4j_driver(monkeypatch):
    mock_driver = MagicMock()
    mock_driver.verify_connectivity = AsyncMock()
    mock_driver.close = AsyncMock()
    
    async def mock_get_driver():
        return mock_driver
    
    monkeypatch.setattr("app.db.neo4j.get_neo4j_driver", mock_get_driver)
    monkeypatch.setattr("app.main.get_neo4j_driver", mock_get_driver)
    return mock_driver


@pytest.fixture
def project_root():
    """Return the project root directory."""
    return Path(__file__).parent.parent


@pytest.fixture
def docker_compose_path(project_root):
    """Return the path to docker-compose.yml."""
    return project_root / "docker-compose.yml"


@pytest.fixture
def docker_compose_content(docker_compose_path):
    """Return the content of docker-compose.yml as a string."""
    with open(docker_compose_path, 'r') as f:
        return f.read()
