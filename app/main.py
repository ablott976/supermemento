"""Main application module for Docker Compose health checks and initialization."""

import logging
import os
import sys
import time

# Configure logging for containerized environment
logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


def wait_for_neo4j(uri: str, user: str, password: str, timeout: int = 60) -> bool:
    """Wait for Neo4j to become available.

    Args:
        uri: Neo4j connection URI
        user: Neo4j username
        password: Neo4j password
        timeout: Maximum time to wait in seconds

    Returns:
        True if Neo4j becomes available, False if timeout exceeded
    """
    start_time = time.time()
    try:
        from neo4j import GraphDatabase
    except ImportError:
        logger.error("neo4j package not installed")
        return False

    driver = GraphDatabase.driver(uri, auth=(user, password))
    while time.time() - start_time < timeout:
        try:
            driver.verify_connectivity()
            logger.info("Neo4j connection established")
            driver.close()
            return True
        except Exception as e:  # noqa: BLE001
            logger.debug(f"Waiting for Neo4j... {e}")
            time.sleep(1)
    driver.close()
    return False


def health_check() -> int:
    """Perform health check against Neo4j.

    Returns:
        0 if healthy, 1 otherwise
    """
    uri = os.environ.get("NEO4J_URI", "bolt://neo4j:7687")
    user = os.environ.get("NEO4J_USER", "neo4j")
    password = os.environ.get("NEO4J_PASSWORD", "password")
    try:
        from neo4j import GraphDatabase

        driver = GraphDatabase.driver(uri, auth=(user, password))
        driver.verify_connectivity()
        driver.close()
        logger.info("Health check passed")
        return 0
    except Exception as e:  # noqa: BLE001
        logger.error(f"Health check failed: {e}")
        return 1


def initialize_database() -> int:
    """Initialize database schema and constraints.

    Returns:
        0 on success, 1 on failure
    """
    uri = os.environ.get("NEO4J_URI", "bolt://neo4j:7687")
    user = os.environ.get("NEO4J_USER", "neo4j")
    password = os.environ.get("NEO4J_PASSWORD", "password")
    if not wait_for_neo4j(uri, user, password):
        logger.error("Failed to connect to Neo4j for initialization")
        return 1

    try:
        from neo4j import GraphDatabase

        driver = GraphDatabase.driver(uri, auth=(user, password))
        # Create constraints and indexes
        constraints = [
            "CREATE CONSTRAINT memory_id IF NOT EXISTS FOR (m:Memory) REQUIRE m.id IS UNIQUE",
            "CREATE CONSTRAINT document_id IF NOT EXISTS FOR (d:Document) REQUIRE d.id IS UNIQUE",
            "CREATE CONSTRAINT container_name IF NOT EXISTS FOR (c:Container) REQUIRE c.tag IS UNIQUE",
            "CREATE INDEX memory_embedding IF NOT EXISTS FOR (m:Memory) ON (m.embedding)",
            "CREATE INDEX memory_valid_from IF NOT EXISTS FOR (m:Memory) ON (m.validFrom)",
            "CREATE INDEX memory_valid_to IF NOT EXISTS FOR (m:Memory) ON (m.validTo)",
        ]
        with driver.session() as session:
            for constraint in constraints:
                try:
                    session.run(constraint)
                    logger.info(f"Applied: {constraint}")
                except Exception as e:  # noqa: BLE001
                    logger.warning(f"Constraint may already exist: {e}")
        driver.close()
        logger.info("Database initialization complete")
        return 0
    except Exception as e:  # noqa: BLE001
        logger.error(f"Initialization failed: {e}")
        return 1


def process_data(data: list[int]) -> list[int]:
    """Process data by doubling each value.

    Args:
        data: List of integers to process.

    Returns:
        List of doubled integers.
    """
    return [x * 2 for x in data]


def main() -> None:
    """Main entry point with Docker Compose support."""
    command = sys.argv[1] if len(sys.argv) > 1 else "serve"
    if command == "healthcheck":
        sys.exit(health_check())
    elif command in ("init", "migrate"):
        sys.exit(initialize_database())
    elif command == "wait":
        # Wait for dependencies to be ready
        uri = os.environ.get("NEO4J_URI", "bolt://neo4j:7687")
        user = os.environ.get("NEO4J_USER", "neo4j")
        password = os.environ.get("NEO4J_PASSWORD", "password")
        if wait_for_neo4j(uri, user, password):
            logger.info("Dependencies ready")
            sys.exit(0)
        else:
            logger.error("Dependencies failed to become ready")
            sys.exit(1)
    else:
        # Default serve mode
        logger.info("Starting application server")
        data = [1, 2, 3, 4, 5]
        result = process_data(data)
        logger.info(f"Processed data: {result}")
        sys.exit(0)


if __name__ == "__main__":
    main()
