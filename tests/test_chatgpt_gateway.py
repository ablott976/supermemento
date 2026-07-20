from __future__ import annotations

import asyncio
from pathlib import Path
from urllib.parse import urlencode, urlparse

from cryptography.fernet import Fernet
from fastmcp import Client, FastMCP
from fastmcp.server import create_proxy
from fastmcp.server.auth import RemoteAuthProvider
from fastmcp.server.auth.providers.github import GitHubProvider, GitHubTokenVerifier
import httpx
from key_value.aio.stores.memory import MemoryStore
from pydantic import AnyHttpUrl
from starlette.testclient import TestClient

from chatgpt_gateway.config import GatewaySettings
from chatgpt_gateway.server import (
    ALLOWED_TOOLS,
    build_auth_provider,
    build_redis_client,
    build_transforms,
    create_gateway,
    is_allowed_github_user,
)


def settings() -> GatewaySettings:
    return GatewaySettings(
        public_base_url="https://mcp.example.test",
        public_hostname="mcp.example.test",
        upstream_mcp_url="http://supermemento:80/mcp",
        upstream_health_url="http://supermemento:80/health",
        github_client_id="Ov23liExampleClient",
        github_client_secret="g" * 40,
        jwt_signing_key="j" * 64,
        storage_encryption_key=Fernet.generate_key().decode("ascii"),
        redis_host="redis",
        redis_port=6379,
        redis_db=0,
        redis_password="r" * 32,
        allowed_github_users=frozenset({"ablott976"}),
        allowed_client_redirect_uris=(
            "https://chatgpt.com/connector_platform_oauth_redirect",
        ),
        port=8080,
    )


def test_settings_load_secrets_from_files_and_reject_public_upstream(
    monkeypatch, tmp_path: Path
) -> None:
    secret_values = {
        "GITHUB_OAUTH_CLIENT_SECRET": "g" * 40,
        "MCP_GATEWAY_JWT_SIGNING_KEY": "j" * 64,
        "MCP_GATEWAY_STORAGE_ENCRYPTION_KEY": Fernet.generate_key().decode("ascii"),
        "MCP_GATEWAY_REDIS_PASSWORD": "r" * 32,
    }
    monkeypatch.setenv("GITHUB_OAUTH_CLIENT_ID", "Ov23liExampleClient")
    monkeypatch.setenv("ALLOWED_GITHUB_USERS", "ablott976")
    for name, value in secret_values.items():
        path = tmp_path / name.lower()
        path.write_text(value, encoding="utf-8")
        monkeypatch.setenv(f"{name}_FILE", str(path))
    loaded = GatewaySettings.from_env()
    assert loaded.allowed_github_users == frozenset({"ablott976"})
    assert "g" * 20 not in repr(loaded)

    monkeypatch.setenv(
        "UPSTREAM_MCP_URL", "https://n8n-supermemento.9kpuqs.easypanel.host/mcp"
    )
    try:
        GatewaySettings.from_env()
    except ValueError as exc:
        assert "internal HTTP URL" in str(exc)
    else:
        raise AssertionError("public upstream URL must fail closed")


def test_user_allowlist_is_case_insensitive_and_fail_closed() -> None:
    allowed = frozenset({"ablott976"})
    assert is_allowed_github_user({"login": "ABLott976"}, allowed)
    assert not is_allowed_github_user({"login": "attacker"}, allowed)
    assert not is_allowed_github_user({}, allowed)
    assert not is_allowed_github_user(None, allowed)


def test_redis_client_decodes_strings_for_encrypted_oauth_storage() -> None:
    client = build_redis_client(settings())
    assert client.connection_pool.connection_kwargs["decode_responses"] is True
    asyncio.run(client.aclose())


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
    async def delete_memory(memoryId: str) -> dict:
        return {"deleted": memoryId}

    defined = {"semantic_search", "get_user_profile", "list_memories", "list_documents"}
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
            assert tool_map["semantic_search"].annotations.destructiveHint is False
            assert tool_map["create_memory"].annotations.readOnlyHint is False
            assert "ingest_url" not in tool_map
            assert "ingest_document" not in tool_map
            assert "crawl_url" not in tool_map
            assert "crawl_urls" not in tool_map
            profile_schema = tool_map["get_user_profile"].inputSchema
            assert "regenerate" not in profile_schema["properties"]
            result = await client.call_tool("semantic_search", {"query": "GoTimeCloud"})
            assert result.data == {
                "query": "GoTimeCloud",
                "containerTag": "zkteco-pmm",
                "searchMode": "memory",
                "rewriteQuery": True,
                "limit": 5,
            }
            try:
                await client.call_tool("delete_memory", {"memoryId": "blocked"})
            except Exception as exc:
                assert "Unknown tool" in str(exc)
            else:
                raise AssertionError("hidden destructive tool must not be callable")

    asyncio.run(run())


def test_oauth_metadata_and_unauthenticated_mcp_challenge() -> None:
    cfg = settings()
    provider = build_auth_provider(cfg, client_storage=MemoryStore())
    assert isinstance(provider, GitHubProvider)
    gateway = create_gateway(cfg, target=_backend(), auth_provider=provider)
    app = gateway.http_app(path="/mcp", transport="http", stateless_http=True)

    with TestClient(app) as client:
        response = client.post(
            "/mcp",
            headers={"Accept": "application/json, text/event-stream"},
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2025-03-26",
                    "capabilities": {},
                    "clientInfo": {"name": "test", "version": "1"},
                },
            },
        )
        assert response.status_code == 401
        challenge = response.headers.get("www-authenticate", "")
        assert "resource_metadata" in challenge

        protected = client.get("/.well-known/oauth-protected-resource/mcp")
        assert protected.status_code == 200
        payload = protected.json()
        assert payload["resource"] == "https://mcp.example.test/mcp"
        assert payload["authorization_servers"] == [
            "https://mcp.example.test/"
        ] or payload["authorization_servers"] == ["https://mcp.example.test"]

        authorization = client.get("/.well-known/oauth-authorization-server")
        assert authorization.status_code == 200
        metadata = authorization.json()
        assert metadata["code_challenge_methods_supported"] == ["S256"]
        assert metadata["registration_endpoint"].startswith("https://mcp.example.test/")

        registration_path = urlparse(metadata["registration_endpoint"]).path
        registration = {
            "client_name": "ChatGPT test",
            "redirect_uris": ["https://chatgpt.com/connector_platform_oauth_redirect"],
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"],
            "token_endpoint_auth_method": "none",
        }
        allowed_registration = client.post(registration_path, json=registration)
        assert allowed_registration.status_code == 201

        rejected_registration = client.post(
            registration_path,
            json={**registration, "redirect_uris": ["https://evil.example/callback"]},
        )
        assert rejected_registration.status_code == 400
        assert rejected_registration.json()["error"] == "invalid_redirect_uri"

        authorization_path = urlparse(metadata["authorization_endpoint"]).path
        bad_authorization = client.get(
            authorization_path
            + "?"
            + urlencode(
                {
                    "response_type": "code",
                    "client_id": allowed_registration.json()["client_id"],
                    "redirect_uri": "https://evil.example/callback",
                    "code_challenge": "x" * 43,
                    "code_challenge_method": "S256",
                }
            ),
            follow_redirects=False,
        )
        assert bad_authorization.status_code == 400
        assert bad_authorization.json()["error"] == "invalid_request"


def test_verified_github_identity_is_enforced_end_to_end() -> None:
    cfg = settings()

    def github_api(request: httpx.Request) -> httpx.Response:
        token = request.headers.get("Authorization", "").removeprefix("Bearer ")
        login = "ablott976" if token == "allowed-token" else "attacker"
        if request.url.path == "/user":
            return httpx.Response(
                200,
                json={
                    "id": 1 if login == "ablott976" else 2,
                    "login": login,
                    "name": login,
                    "email": None,
                },
            )
        if request.url.path == "/user/repos":
            return httpx.Response(200, json=[], headers={"x-oauth-scopes": ""})
        return httpx.Response(404)

    github_client = httpx.AsyncClient(transport=httpx.MockTransport(github_api))
    verifier = GitHubTokenVerifier(required_scopes=[], http_client=github_client)
    provider = RemoteAuthProvider(
        token_verifier=verifier,
        authorization_servers=[AnyHttpUrl("https://github.example.test")],
        base_url=cfg.public_base_url,
    )
    gateway = create_gateway(
        cfg,
        target=_backend(),
        auth_provider=provider,
        http_client=github_client,
    )
    app = gateway.http_app(
        path="/mcp",
        transport="http",
        stateless_http=True,
        json_response=True,
    )

    def mcp_post(
        client: TestClient,
        token: str,
        method: str,
        params: dict,
        request_id: int,
    ):
        return client.post(
            "/mcp",
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/json, text/event-stream",
            },
            json={
                "jsonrpc": "2.0",
                "id": request_id,
                "method": method,
                "params": params,
            },
        )

    initialize = {
        "protocolVersion": "2025-03-26",
        "capabilities": {},
        "clientInfo": {"name": "test", "version": "1"},
    }
    with TestClient(app) as client:
        assert (
            mcp_post(client, "allowed-token", "initialize", initialize, 1).status_code
            == 200
        )
        allowed_tools = mcp_post(client, "allowed-token", "tools/list", {}, 2)
        assert allowed_tools.status_code == 200
        assert {
            tool["name"] for tool in allowed_tools.json()["result"]["tools"]
        } == set(ALLOWED_TOOLS)
        allowed_call = mcp_post(
            client,
            "allowed-token",
            "tools/call",
            {"name": "semantic_search", "arguments": {"query": "test"}},
            3,
        )
        assert allowed_call.status_code == 200
        assert allowed_call.json()["result"]["isError"] is False

        assert (
            mcp_post(client, "attacker-token", "initialize", initialize, 4).status_code
            == 200
        )
        denied_tools = mcp_post(client, "attacker-token", "tools/list", {}, 5)
        assert denied_tools.status_code == 200
        assert denied_tools.json()["result"]["tools"] == []
        denied_call = mcp_post(
            client,
            "attacker-token",
            "tools/call",
            {"name": "semantic_search", "arguments": {"query": "test"}},
            6,
        )
        assert denied_call.status_code == 200
        assert denied_call.json()["result"]["isError"] is True
        assert (
            "insufficient permissions"
            in denied_call.json()["result"]["content"][0]["text"]
        )
