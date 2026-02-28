import os
import pytest
from unittest.mock import AsyncMock, MagicMock

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

@pytest.fixture(scope="session", autouse=True)
def setup_test_environment(request):
    """
    Set necessary environment variables for the entire test session.
    Ensures NEO4J_PASSWORD and RUNNING_TESTS are set before any modules are imported.
    Includes print statements for debugging.
    """
    print("\n--- Setting up test environment ---")
    
    # Store original values
    original_neo4j_password = os.environ.pop("NEO4J_PASSWORD", None)
    original_running_tests = os.environ.pop("RUNNING_TESTS", None)
    
    # Set test variables
    os.environ["NEO4J_PASSWORD"] = "test_neo4j_password_for_pytest"
    os.environ["RUNNING_TESTS"] = "1" # Flag to bypass strict check in app/config.py
    
    print(f"  Original NEO4J_PASSWORD: {original_neo4j_password}")
    print(f"  Original RUNNING_TESTS: {original_running_tests}")
    print(f"  Set NEO4J_PASSWORD to: {os.environ['NEO4J_PASSWORD']}")
    print(f"  Set RUNNING_TESTS to: {os.environ['RUNNING_TESTS']}")
    
    yield
    
    # Clean up
    print("--- Cleaning up test environment ---")
    if original_neo4j_password is None:
        if "NEO4J_PASSWORD" in os.environ:
            del os.environ["NEO4J_PASSWORD"]
            print("  Unset NEO4J_PASSWORD")
    else:
        os.environ["NEO4J_PASSWORD"] = original_neo4j_password
        print(f"  Restored NEO4J_PASSWORD to: {os.environ['NEO4J_PASSWORD']}")

    if original_running_tests is None:
        if "RUNNING_TESTS" in os.environ:
            del os.environ["RUNNING_TESTS"]
            print("  Unset RUNNING_TESTS")
    else:
        os.environ["RUNNING_TESTS"] = original_running_tests
        print(f"  Restored RUNNING_TESTS to: {os.environ['RUNNING_TESTS']}")
