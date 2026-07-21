from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import os
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from fastmcp import Client, FastMCP
from fastmcp.server import create_proxy
from fastmcp.server.auth import RemoteAuthProvider
import httpx
import pytest
from starlette.testclient import TestClient

from chatgpt_gateway.config import GatewaySettings
from chatgpt_gateway.owner_oauth import (
    GatewayOAuthManager,
    OAuthFlowError,
    OAuthStoreError,
    sha256_token,
)
from chatgpt_gateway.server import (
    ALLOWED_TOOLS,
    build_auth_provider,
    build_oauth_manager,
    build_transforms,
    create_gateway,
)


OWNER_TOKEN = "smo_" + "owner-token-for-focused-tests" * 2
CHATGPT_REDIRECT = "https://chatgpt.com/connector_platform_oauth_redirect"


def settings(tmp_path: Path) -> GatewaySettings:
    return GatewaySettings(
        public_base_url="https://mcp.example.test",
        public_hostname="mcp.example.test",
        upstream_mcp_url="http://supermemento:80/mcp",
        upstream_health_url="http://supermemento:80/health",
        owner_token_sha256=sha256_token(OWNER_TOKEN),
        oauth_store_path=str(tmp_path / "oauth-store.json"),
        allowed_client_redirect_uris=(CHATGPT_REDIRECT,),
        port=8080,
    )


def _pkce_challenge(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def _register_client(manager) -> dict:
    return manager.register_client(
        {
            "client_name": "ChatGPT test",
            "redirect_uris": [CHATGPT_REDIRECT],
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"],
            "token_endpoint_auth_method": "none",
            "scope": "supermemento:access",
        }
    )


def _issue_token(manager, client_id: str) -> tuple[str, str, str]:
    verifier = "v" * 64
    pending = manager.start_authorization(
        {
            "response_type": "code",
            "client_id": client_id,
            "redirect_uri": CHATGPT_REDIRECT,
            "scope": "supermemento:access",
            "state": "test-state",
            "resource": "https://mcp.example.test/mcp",
            "code_challenge": _pkce_challenge(verifier),
            "code_challenge_method": "S256",
        }
    )
    redirect = manager.complete_authorization(
        request_id=pending.request_id,
        csrf_token=pending.csrf_token,
        setup_token=OWNER_TOKEN,
    )
    code = parse_qs(urlparse(redirect).query)["code"][0]
    token = manager.exchange_token(
        {
            "grant_type": "authorization_code",
            "client_id": client_id,
            "redirect_uri": CHATGPT_REDIRECT,
            "code": code,
            "code_verifier": verifier,
        },
        {},
    )
    return token["access_token"], token["refresh_token"], code


def test_settings_load_hash_from_file_and_reject_public_upstream(
    monkeypatch, tmp_path: Path
) -> None:
    hash_path = tmp_path / "owner-token.sha256"
    hash_path.write_text(sha256_token(OWNER_TOKEN), encoding="utf-8")
    monkeypatch.setenv("MCP_GATEWAY_OWNER_TOKEN_SHA256_FILE", str(hash_path))
    monkeypatch.setenv("MCP_GATEWAY_OAUTH_STORE_PATH", str(tmp_path / "oauth.json"))
    loaded = GatewaySettings.from_env()
    assert loaded.owner_token_sha256 == sha256_token(OWNER_TOKEN)
    assert loaded.owner_token_sha256 not in repr(loaded)

    monkeypatch.setenv(
        "UPSTREAM_MCP_URL", "https://n8n-supermemento.9kpuqs.easypanel.host/mcp"
    )
    with pytest.raises(ValueError, match="internal HTTP URL"):
        GatewaySettings.from_env()


def test_owner_oauth_pkce_persists_hashes_and_refreshes(tmp_path: Path) -> None:
    cfg = settings(tmp_path)
    manager = build_oauth_manager(cfg)
    assert asyncio.run(manager.verify_token(OWNER_TOKEN)) is None
    pseudo_legacy = f"disabled-direct-bearer:{cfg.owner_token_sha256}"
    assert asyncio.run(manager.verify_token(pseudo_legacy)) is None
    client = _register_client(manager)

    denied = manager.start_authorization(
        {
            "response_type": "code",
            "client_id": client["client_id"],
            "redirect_uri": CHATGPT_REDIRECT,
            "resource": "https://mcp.example.test/mcp",
            "code_challenge": _pkce_challenge("x" * 64),
            "code_challenge_method": "S256",
        }
    )
    with pytest.raises(OAuthFlowError, match="setup token"):
        manager.complete_authorization(
            request_id=denied.request_id,
            csrf_token=denied.csrf_token,
            setup_token="wrong-token",
        )

    verifier = "p" * 64
    pending = manager.start_authorization(
        {
            "response_type": "code",
            "client_id": client["client_id"],
            "redirect_uri": CHATGPT_REDIRECT,
            "scope": "supermemento:access",
            "resource": "https://mcp.example.test/mcp",
            "code_challenge": _pkce_challenge(verifier),
            "code_challenge_method": "S256",
        }
    )
    redirect = manager.complete_authorization(
        request_id=pending.request_id,
        csrf_token=pending.csrf_token,
        setup_token=OWNER_TOKEN,
    )
    code = parse_qs(urlparse(redirect).query)["code"][0]
    exchange = {
        "grant_type": "authorization_code",
        "client_id": client["client_id"],
        "redirect_uri": CHATGPT_REDIRECT,
        "code": code,
    }
    with pytest.raises(OAuthFlowError, match="code_verifier"):
        manager.exchange_token({**exchange, "code_verifier": "wrong"}, {})
    with pytest.raises(OAuthFlowError, match="redirect_uri"):
        manager.exchange_token(
            {
                **exchange,
                "redirect_uri": "https://chatgpt.com/wrong",
                "code_verifier": verifier,
            },
            {},
        )
    issued = manager.exchange_token({**exchange, "code_verifier": verifier}, {})
    access_token = issued["access_token"]
    refresh_token = issued["refresh_token"]
    verified = asyncio.run(manager.verify_token(access_token))
    assert verified is not None
    assert verified.resource == "https://mcp.example.test/mcp"

    persisted = Path(cfg.oauth_store_path).read_text(encoding="utf-8")
    for raw_secret in (OWNER_TOKEN, access_token, refresh_token, code):
        assert raw_secret not in persisted

    restored = build_oauth_manager(cfg)
    assert asyncio.run(restored.verify_token(access_token)) is not None
    with pytest.raises(OAuthFlowError, match="authorization code"):
        restored.exchange_token(
            {
                "grant_type": "authorization_code",
                "client_id": client["client_id"],
                "redirect_uri": CHATGPT_REDIRECT,
                "code": code,
                "code_verifier": verifier,
            },
            {},
        )
    with pytest.raises(OAuthFlowError, match="requested scope"):
        restored.exchange_token(
            {
                "grant_type": "refresh_token",
                "client_id": client["client_id"],
                "refresh_token": refresh_token,
                "scope": "not-allowed",
            },
            {},
        )
    refreshed = restored.exchange_token(
        {
            "grant_type": "refresh_token",
            "client_id": client["client_id"],
            "refresh_token": refresh_token,
        },
        {},
    )
    assert refreshed["access_token"] != access_token

    restored_again = build_oauth_manager(cfg)
    assert (
        asyncio.run(restored_again.verify_token(refreshed["access_token"])) is not None
    )
    with pytest.raises(OAuthFlowError, match="refresh token"):
        restored_again.exchange_token(
            {
                "grant_type": "refresh_token",
                "client_id": client["client_id"],
                "refresh_token": refresh_token,
            },
            {},
        )


def test_invalid_oauth_store_fails_closed(tmp_path: Path) -> None:
    cfg = settings(tmp_path)
    Path(cfg.oauth_store_path).write_text("not-json", encoding="utf-8")
    with pytest.raises(OAuthStoreError):
        build_oauth_manager(cfg)


def test_directory_fsync_failure_poisoned_manager_fails_closed(
    monkeypatch, tmp_path: Path
) -> None:
    cfg = settings(tmp_path)
    manager = build_oauth_manager(cfg)
    real_fsync = os.fsync
    calls = 0

    def fail_directory_fsync(fd: int) -> None:
        nonlocal calls
        calls += 1
        if calls == 2:
            raise OSError("simulated directory fsync failure")
        real_fsync(fd)

    monkeypatch.setattr(os, "fsync", fail_directory_fsync)
    with pytest.raises(OAuthStoreError, match="could not be written"):
        _register_client(manager)
    assert calls == 2
    assert manager.storage_healthy is False
    assert asyncio.run(manager.verify_token(OWNER_TOKEN)) is None
    with pytest.raises(OAuthStoreError, match="durability"):
        _register_client(manager)


def test_ready_checks_existing_store_parent(
    monkeypatch, tmp_path: Path
) -> None:
    cfg = settings(tmp_path)
    manager = build_oauth_manager(cfg)
    _register_client(manager)
    provider = build_auth_provider(cfg, manager)
    http_client = httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda _request: httpx.Response(200, json={"status": "ok"})
        )
    )
    gateway = create_gateway(
        cfg,
        target=_backend(),
        auth_provider=provider,
        oauth_manager=manager,
        http_client=http_client,
    )
    app = gateway.http_app(path="/mcp", transport="http", stateless_http=True)
    checked: list[tuple[Path, int]] = []

    def deny_access(path: os.PathLike[str], mode: int) -> bool:
        checked.append((Path(path), mode))
        return False

    with TestClient(app) as client:
        monkeypatch.setattr(os, "access", deny_access)
        response = client.get("/ready")

    assert response.status_code == 503
    assert response.json() == {"status": "unavailable"}
    assert checked == [(tmp_path, os.W_OK | os.X_OK)]


def test_authorized_client_capacity_is_bounded(tmp_path: Path) -> None:
    store_path = tmp_path / "bounded-oauth.json"
    manager = GatewayOAuthManager(
        issuer_url="https://mcp.example.test",
        resource_url="https://mcp.example.test/mcp",
        legacy_token_sha256=None,
        consent_token_sha256=sha256_token(OWNER_TOKEN),
        max_clients=1,
        oauth_store_path=str(store_path),
    )
    first = _register_client(manager)
    _issue_token(manager, first["client_id"])
    before = json.loads(store_path.read_text(encoding="utf-8"))["clients"]
    assert len(before) == 1

    with pytest.raises(OAuthFlowError, match="capacity"):
        _register_client(manager)
    after = json.loads(store_path.read_text(encoding="utf-8"))["clients"]
    assert after == before


def test_client_with_pending_authorization_is_not_evicted_at_capacity(
    tmp_path: Path,
) -> None:
    manager = GatewayOAuthManager(
        issuer_url="https://mcp.example.test",
        resource_url="https://mcp.example.test/mcp",
        consent_token_sha256=sha256_token(OWNER_TOKEN),
        max_clients=1,
        oauth_store_path=str(tmp_path / "bounded-oauth.json"),
    )
    client = _register_client(manager)
    manager.start_authorization(
        {
            "response_type": "code",
            "client_id": client["client_id"],
            "redirect_uri": CHATGPT_REDIRECT,
            "code_challenge": _pkce_challenge("p" * 64),
            "code_challenge_method": "S256",
        }
    )

    with pytest.raises(OAuthFlowError, match="capacity"):
        _register_client(manager)


def test_expired_authorized_client_is_evicted_at_capacity(tmp_path: Path) -> None:
    store_path = tmp_path / "bounded-oauth.json"
    manager = GatewayOAuthManager(
        issuer_url="https://mcp.example.test",
        resource_url="https://mcp.example.test/mcp",
        legacy_token_sha256=None,
        consent_token_sha256=sha256_token(OWNER_TOKEN),
        access_token_ttl_seconds=-1,
        refresh_token_ttl_seconds=-1,
        max_clients=1,
        oauth_store_path=str(store_path),
    )
    expired = _register_client(manager)
    _issue_token(manager, expired["client_id"])

    replacement = _register_client(manager)

    clients = json.loads(store_path.read_text(encoding="utf-8"))["clients"]
    assert list(clients) == [replacement["client_id"]]


def _backend() -> FastMCP:
    backend = FastMCP("backend")

    @backend.tool
    async def semantic_search(
        query: str,
        containerTag: str | None = None,
        searchMode: str = "hybrid",
        rewriteQuery: bool = False,
        limit: int = 10,
    ) -> dict:
        return {
            "query": query,
            "containerTag": containerTag,
            "searchMode": searchMode,
            "rewriteQuery": rewriteQuery,
            "limit": limit,
        }

    @backend.tool
    async def get_user_profile(
        containerTag: str,
        regenerate: bool = False,
        includeSearch: bool = False,
    ) -> dict:
        return {"containerTag": containerTag, "regenerate": regenerate}

    @backend.tool
    async def list_memories(
        containerTag: str | None = None,
        isLatest: bool | None = None,
        limit: int = 50,
    ) -> dict:
        return {"containerTag": containerTag, "isLatest": isLatest, "limit": limit}

    @backend.tool
    async def list_documents(
        containerTag: str | None = None,
        limit: int = 50,
    ) -> dict:
        return {"containerTag": containerTag, "limit": limit}

    @backend.tool
    async def list_crawled_urls(containerTag: str | None = None) -> dict:
        return {"containerTag": containerTag}

    @backend.tool
    async def delete_memory(memoryId: str) -> dict:
        return {"deleted": memoryId}

    defined = {
        "semantic_search",
        "get_user_profile",
        "list_memories",
        "list_documents",
        "list_crawled_urls",
    }
    for name in ALLOWED_TOOLS - defined:

        async def placeholder(value: str = "") -> dict:
            return {"value": value}

        placeholder.__name__ = name
        backend.tool(placeholder)
    return backend


def test_tool_surface_is_allowlisted_annotated_and_uses_safe_defaults() -> None:
    async def run() -> None:
        proxy = create_proxy(
            _backend(), name="test-proxy", transforms=build_transforms()
        )
        async with Client(proxy) as client:
            tools = await client.list_tools()
            tool_map = {tool.name: tool for tool in tools}
            assert set(tool_map) == set(ALLOWED_TOOLS)
            assert "delete_memory" not in tool_map
            assert tool_map["semantic_search"].annotations.readOnlyHint is True
            assert tool_map["create_memory"].annotations.readOnlyHint is False
            assert "ingest_url" not in tool_map
            assert "ingest_document" not in tool_map
            assert "crawl_url" not in tool_map
            assert "crawl_urls" not in tool_map
            assert (
                "regenerate"
                not in tool_map["get_user_profile"].inputSchema["properties"]
            )
            result = await client.call_tool("semantic_search", {"query": "GoTimeCloud"})
            assert result.data == {
                "query": "GoTimeCloud",
                "containerTag": "zkteco-pmm",
                "searchMode": "memory",
                "rewriteQuery": True,
                "limit": 5,
            }
            crawled_urls = await client.call_tool("list_crawled_urls", {})
            assert crawled_urls.data == {"containerTag": "zkteco-pmm"}

    asyncio.run(run())


def test_http_oauth_dcr_redirects_and_authenticated_mcp(tmp_path: Path) -> None:
    cfg = settings(tmp_path)
    manager = build_oauth_manager(cfg)
    provider = build_auth_provider(cfg, manager)
    assert isinstance(provider, RemoteAuthProvider)
    gateway = create_gateway(
        cfg,
        target=_backend(),
        auth_provider=provider,
        oauth_manager=manager,
    )
    app = gateway.http_app(
        path="/mcp",
        transport="http",
        stateless_http=True,
        json_response=True,
    )

    with TestClient(app) as client:
        initialize = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-03-26",
                "capabilities": {},
                "clientInfo": {"name": "test", "version": "1"},
            },
        }
        unauthenticated = client.post(
            "/mcp",
            headers={"Accept": "application/json, text/event-stream"},
            json=initialize,
        )
        assert unauthenticated.status_code == 401
        assert "resource_metadata" in unauthenticated.headers.get(
            "www-authenticate", ""
        )

        protected = client.get("/.well-known/oauth-protected-resource/mcp")
        assert protected.status_code == 200
        assert protected.json()["resource"] == "https://mcp.example.test/mcp"
        authorization = client.get("/.well-known/oauth-authorization-server")
        assert authorization.status_code == 200
        assert authorization.json()["code_challenge_methods_supported"] == ["S256"]

        registration = {
            "client_name": "ChatGPT test",
            "redirect_uris": [CHATGPT_REDIRECT],
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"],
            "token_endpoint_auth_method": "none",
            "scope": "supermemento:access",
        }
        allowed_registration = client.post("/register", json=registration)
        assert allowed_registration.status_code == 201
        rejected_registration = client.post(
            "/register",
            json={**registration, "redirect_uris": ["https://evil.example/callback"]},
        )
        assert rejected_registration.status_code == 400
        assert rejected_registration.json()["error"] == "invalid_redirect_uri"

        access_token, _, _ = _issue_token(
            manager, allowed_registration.json()["client_id"]
        )
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Accept": "application/json, text/event-stream",
        }
        initialized = client.post("/mcp", headers=headers, json=initialize)
        assert initialized.status_code == 200
        tools = client.post(
            "/mcp",
            headers=headers,
            json={"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}},
        )
        assert tools.status_code == 200
        assert {tool["name"] for tool in tools.json()["result"]["tools"]} == set(
            ALLOWED_TOOLS
        )
        call = client.post(
            "/mcp",
            headers=headers,
            json={
                "jsonrpc": "2.0",
                "id": 3,
                "method": "tools/call",
                "params": {
                    "name": "semantic_search",
                    "arguments": {"query": "test"},
                },
            },
        )
        assert call.status_code == 200
        assert call.json()["result"]["isError"] is False

        hidden_call = client.post(
            "/mcp",
            headers=headers,
            json={
                "jsonrpc": "2.0",
                "id": 4,
                "method": "tools/call",
                "params": {
                    "name": "delete_memory",
                    "arguments": {"memoryId": "blocked"},
                },
            },
        )
        assert hidden_call.status_code == 200
        assert hidden_call.json()["result"]["isError"] is True
        assert "Unknown tool" in hidden_call.json()["result"]["content"][0]["text"]


def test_ready_checks_store_and_upstream(tmp_path: Path) -> None:
    cfg = settings(tmp_path)
    manager = build_oauth_manager(cfg)
    provider = build_auth_provider(cfg, manager)

    def upstream(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/health"
        return httpx.Response(200, json={"status": "ok"})

    http_client = httpx.AsyncClient(transport=httpx.MockTransport(upstream))
    gateway = create_gateway(
        cfg,
        target=_backend(),
        auth_provider=provider,
        oauth_manager=manager,
        http_client=http_client,
    )
    app = gateway.http_app(path="/mcp", transport="http", stateless_http=True)
    with TestClient(app) as client:
        response = client.get("/ready")
        assert response.status_code == 200
        assert response.json() == {"status": "ready"}
