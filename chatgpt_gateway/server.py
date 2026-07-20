"""OAuth-protected, least-privilege MCP proxy for ChatGPT."""

from __future__ import annotations

from contextlib import asynccontextmanager
from dataclasses import dataclass
import logging
from typing import Any, AsyncIterator, Sequence

from cryptography.fernet import Fernet
from fastmcp.server import create_proxy
from fastmcp.server.auth.providers.github import GitHubProvider
from fastmcp.server.middleware.authorization import AuthContext, AuthMiddleware
from fastmcp.server.middleware.rate_limiting import RateLimitingMiddleware
from fastmcp.server.middleware.response_limiting import ResponseLimitingMiddleware
from fastmcp.server.transforms import ToolTransform, Transform, Visibility
from fastmcp.tools import Tool
from fastmcp.tools.tool_transform import ArgTransformConfig, ToolTransformConfig
import httpx
from key_value.aio.stores.redis import RedisStore
from key_value.aio.wrappers.encryption import FernetEncryptionWrapper
from mcp.types import ToolAnnotations
from redis.asyncio import Redis
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from .config import GatewaySettings


logger = logging.getLogger("supermemento.chatgpt_gateway")


@dataclass(frozen=True)
class ToolPolicy:
    read_only: bool
    idempotent: bool
    open_world: bool = False


TOOL_POLICIES: dict[str, ToolPolicy] = {
    "semantic_search": ToolPolicy(read_only=True, idempotent=True),
    "list_memories": ToolPolicy(read_only=True, idempotent=True),
    "create_memory": ToolPolicy(read_only=False, idempotent=False),
    "ingest_conversation": ToolPolicy(read_only=False, idempotent=False),
    "get_document_status": ToolPolicy(read_only=True, idempotent=True),
    "list_documents": ToolPolicy(read_only=True, idempotent=True),
    "get_user_profile": ToolPolicy(read_only=True, idempotent=True),
    "get_memory_relations": ToolPolicy(read_only=True, idempotent=True),
    "list_crawled_urls": ToolPolicy(read_only=True, idempotent=True),
}

ALLOWED_TOOLS = frozenset(TOOL_POLICIES)


class ChatGPTAnnotations(Transform):
    """Attach explicit MCP safety annotations to allowlisted tools."""

    @staticmethod
    def _annotate(tool: Tool) -> Tool:
        policy = TOOL_POLICIES.get(tool.name)
        if policy is None:
            return tool
        annotations = ToolAnnotations(
            readOnlyHint=policy.read_only,
            destructiveHint=False,
            idempotentHint=policy.idempotent,
            openWorldHint=policy.open_world,
        )
        return tool.model_copy(update={"annotations": annotations})

    async def list_tools(self, tools: Sequence[Tool]) -> Sequence[Tool]:
        return [self._annotate(tool) for tool in tools]

    async def get_tool(
        self,
        name: str,
        call_next: Any,
        *,
        version: Any = None,
    ) -> Tool | None:
        tool = await call_next(name, version=version)
        return None if tool is None else self._annotate(tool)


def build_transforms() -> list[Transform]:
    """Return deny-by-default visibility and safe ChatGPT-facing defaults."""
    defaults = {
        "semantic_search": ToolTransformConfig(
            arguments={
                "containerTag": ArgTransformConfig(default="zkteco-pmm"),
                "searchMode": ArgTransformConfig(default="memory"),
                "rewriteQuery": ArgTransformConfig(default=True),
                "limit": ArgTransformConfig(default=5),
            }
        ),
        "list_memories": ToolTransformConfig(
            arguments={
                "containerTag": ArgTransformConfig(default="zkteco-pmm"),
                "isLatest": ArgTransformConfig(default=True),
                "limit": ArgTransformConfig(default=10),
            }
        ),
        "list_documents": ToolTransformConfig(
            arguments={"containerTag": ArgTransformConfig(default="zkteco-pmm")}
        ),
        "list_crawled_urls": ToolTransformConfig(
            arguments={"containerTag": ArgTransformConfig(default="zkteco-pmm")}
        ),
        "get_user_profile": ToolTransformConfig(
            arguments={"regenerate": ArgTransformConfig(default=False, hide=True)}
        ),
    }
    return [
        Visibility(False, match_all=True),
        Visibility(True, names=set(ALLOWED_TOOLS), components={"tool"}),
        ToolTransform(defaults),
        ChatGPTAnnotations(),
    ]


def is_allowed_github_user(
    claims: dict[str, Any] | None, allowed_users: frozenset[str]
) -> bool:
    """Fail closed unless the verified token has an explicitly allowed GitHub login."""
    login = claims.get("login") if claims else None
    return isinstance(login, str) and login.lower() in allowed_users


def github_user_check(settings: GatewaySettings):
    async def check(context: AuthContext) -> bool:
        claims = context.token.claims if context.token is not None else None
        return is_allowed_github_user(claims, settings.allowed_github_users)

    return check


def build_auth_provider(
    settings: GatewaySettings,
    *,
    client_storage: Any,
    http_client: httpx.AsyncClient | None = None,
) -> GitHubProvider:
    """Build an MCP-compliant OAuth proxy backed by GitHub identity."""
    return GitHubProvider(
        client_id=settings.github_client_id,
        client_secret=settings.github_client_secret,
        base_url=settings.public_base_url,
        resource_base_url=settings.public_base_url,
        issuer_url=settings.public_base_url,
        redirect_path="/auth/callback",
        required_scopes=[],
        timeout_seconds=10,
        cache_ttl_seconds=60,
        max_cache_size=64,
        allowed_client_redirect_uris=list(settings.allowed_client_redirect_uris),
        client_storage=client_storage,
        jwt_signing_key=settings.jwt_signing_key,
        require_authorization_consent=True,
        forward_resource=False,
        fallback_refresh_token_expiry_seconds=2_592_000,
        fastmcp_access_token_expiry_seconds=3_600,
        token_expiry_threshold_seconds=60,
        http_client=http_client,
        enable_cimd=True,
    )


def create_gateway(
    settings: GatewaySettings,
    *,
    target: Any,
    auth_provider: Any,
    redis_client: Redis | None = None,
    http_client: httpx.AsyncClient | None = None,
):
    """Create the authenticated MCP proxy. Dependencies are injectable for tests."""

    @asynccontextmanager
    async def lifespan(_server: Any) -> AsyncIterator[dict[str, Any]]:
        try:
            yield {}
        finally:
            if http_client is not None:
                await http_client.aclose()
            if redis_client is not None:
                await redis_client.aclose()

    gateway = create_proxy(
        target,
        name="Supermemento for ChatGPT",
        instructions=(
            "Use Supermemento for project knowledge and context, never for task management. "
            "Search with rewriteQuery=true and validate relevance, recency, consistency, and applicability. "
            "Default ZKTeco PMM scope is containerTag zkteco-pmm."
        ),
        auth=auth_provider,
        transforms=build_transforms(),
        middleware=[
            AuthMiddleware(auth=github_user_check(settings)),
            RateLimitingMiddleware(
                max_requests_per_second=5, burst_capacity=10, global_limit=True
            ),
            ResponseLimitingMiddleware(max_size=750_000),
        ],
        lifespan=lifespan,
        mask_error_details=True,
        strict_input_validation=True,
    )

    @gateway.custom_route("/health", methods=["GET"], include_in_schema=False)
    async def health(_request: Request) -> Response:
        return JSONResponse({"status": "ok"})

    @gateway.custom_route("/ready", methods=["GET"], include_in_schema=False)
    async def ready(_request: Request) -> Response:
        if redis_client is None or http_client is None:
            return JSONResponse({"status": "unavailable"}, status_code=503)
        try:
            upstream = await http_client.get(settings.upstream_health_url)
            redis_ok = bool(await redis_client.ping())
            if upstream.status_code != 200 or not redis_ok:
                raise RuntimeError("dependency unavailable")
        except Exception:
            return JSONResponse({"status": "unavailable"}, status_code=503)
        return JSONResponse({"status": "ready"})

    return gateway


def build_redis_client(settings: GatewaySettings) -> Redis:
    """Create the OAuth storage client with string decoding required by RedisStore."""
    return Redis(
        host=settings.redis_host,
        port=settings.redis_port,
        db=settings.redis_db,
        password=settings.redis_password,
        decode_responses=True,
        socket_connect_timeout=3,
        socket_timeout=3,
        health_check_interval=30,
    )


def build_production_gateway(settings: GatewaySettings):
    redis_client = build_redis_client(settings)
    store = RedisStore(
        client=redis_client,
        default_collection="supermemento-chatgpt-oauth",
    )
    encrypted_store = FernetEncryptionWrapper(
        key_value=store,
        fernet=Fernet(settings.storage_encryption_key.encode("ascii")),
    )
    http_client = httpx.AsyncClient(
        timeout=httpx.Timeout(10.0),
        follow_redirects=False,
        headers={"User-Agent": "supermemento-chatgpt-gateway/1.0"},
    )
    auth_provider = build_auth_provider(
        settings,
        client_storage=encrypted_store,
        http_client=http_client,
    )
    return create_gateway(
        settings,
        target=settings.upstream_mcp_url,
        auth_provider=auth_provider,
        redis_client=redis_client,
        http_client=http_client,
    )


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
    settings = GatewaySettings.from_env()
    gateway = build_production_gateway(settings)
    gateway.run(
        transport="http",
        host="0.0.0.0",
        port=settings.port,
        path="/mcp",
        stateless_http=True,
        show_banner=False,
        host_origin_protection=True,
        allowed_hosts=[
            settings.public_hostname,
            "localhost",
            "127.0.0.1",
            "supermemento-chatgpt",
            "n8n-supermemento-chatgpt",
        ],
        uvicorn_config={"access_log": False, "server_header": False},
    )


if __name__ == "__main__":
    main()
