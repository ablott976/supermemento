from __future__ import annotations

# ruff: noqa: E402
import pytest

try:
    import fastapi
    import fastapi.testclient as testclient

    from app.api.health import router
    from app.db.neo4j import get_neo4j_driver
except ModuleNotFoundError:
    fastapi = None
    testclient = None
    router = None
    get_neo4j_driver = None

pytestmark = pytest.mark.skipif(
    fastapi is None or testclient is None or router is None or get_neo4j_driver is None,
    reason="fastapi and app package are required for health endpoint tests",
)

FastAPI = fastapi.FastAPI if fastapi else None
HTTPException = fastapi.HTTPException if fastapi else None
TestClient = testclient.TestClient if testclient else None


class HealthyDriver:
    def __init__(self) -> None:
        self.checked = False

    async def verify_connectivity(self) -> None:
        self.checked = True


class UnhealthyDriver:
    async def verify_connectivity(self) -> None:
        raise RuntimeError("connection failed")


def make_client(driver: object) -> TestClient:
    app = FastAPI()
    app.include_router(router)

    async def override_driver() -> object:
        return driver

    app.dependency_overrides[get_neo4j_driver] = override_driver
    return TestClient(app)


def test_health_endpoint_reports_ok_when_neo4j_is_reachable() -> None:
    driver = HealthyDriver()

    with make_client(driver) as client:
        response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "neo4j": "connected"}
    assert driver.checked is True


def test_health_endpoint_reports_unavailable_when_neo4j_is_unreachable() -> None:
    with make_client(UnhealthyDriver()) as client:
        response = client.get("/health")

    assert response.status_code == 503
    assert response.json() == {"detail": "Neo4j connectivity check failed"}


def test_unknown_route_returns_not_found() -> None:
    with make_client(HealthyDriver()) as client:
        response = client.get("/does-not-exist")

    assert response.status_code == 404
    assert response.json() == {"detail": "Not Found"}


def test_error_route_returns_bad_request() -> None:
    app = FastAPI()

    @app.get("/bad-request")
    async def bad_request() -> None:
        raise HTTPException(status_code=400, detail="bad request")

    with TestClient(app) as client:
        response = client.get("/bad-request")

    assert response.status_code == 400
    assert response.json() == {"detail": "bad request"}


def test_error_route_returns_conflict() -> None:
    app = FastAPI()

    @app.get("/conflict")
    async def conflict() -> None:
        raise HTTPException(status_code=409, detail="conflict")

    with TestClient(app) as client:
        response = client.get("/conflict")

    assert response.status_code == 409
    assert response.json() == {"detail": "conflict"}
