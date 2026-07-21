"""Owner-authorized, least-privilege MCP proxy for ChatGPT."""

from __future__ import annotations

from contextlib import asynccontextmanager
from dataclasses import dataclass
import json
import logging
import os
from pathlib import Path
from typing import Any, AsyncIterator, Sequence

from fastmcp.server import create_proxy
from fastmcp.server.auth import RemoteAuthProvider
from fastmcp.server.middleware.rate_limiting import RateLimitingMiddleware
from fastmcp.server.middleware.response_limiting import ResponseLimitingMiddleware
from fastmcp.server.transforms import ToolTransform, Transform, Visibility
from fastmcp.tools import Tool
from fastmcp.tools.tool_transform import ArgTransformConfig, ToolTransformConfig
import httpx
from mcp.types import ToolAnnotations
from pydantic import AnyHttpUrl
from starlette.requests import Request
from starlette.responses import HTMLResponse, JSONResponse, RedirectResponse, Response

from .config import GatewaySettings, client_redirect_uri_allowed
from .owner_oauth import (
    PUBLIC_SCOPES,
    GatewayOAuthManager,
    OAuthFlowError,
    OAuthStoreError,
)


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


def build_oauth_manager(settings: GatewaySettings) -> GatewayOAuthManager:
    """Build the self-hosted owner-consent OAuth provider."""
    return GatewayOAuthManager(
        issuer_url=settings.public_base_url,
        resource_url=f"{settings.public_base_url}/mcp",
        legacy_token_sha256=None,
        consent_token_sha256=settings.owner_token_sha256,
        scopes=PUBLIC_SCOPES,
        oauth_store_path=settings.oauth_store_path,
    )


def build_auth_provider(
    settings: GatewaySettings, oauth_manager: GatewayOAuthManager
) -> RemoteAuthProvider:
    """Advertise the local OAuth issuer and validate its bearer tokens."""
    return RemoteAuthProvider(
        token_verifier=oauth_manager,  # type: ignore[arg-type]
        authorization_servers=[AnyHttpUrl(f"{settings.public_base_url}/")],
        base_url=settings.public_base_url,
        resource_base_url=settings.public_base_url,
        scopes_supported=list(PUBLIC_SCOPES),
        resource_name="Supermemento",
    )


def _no_store_headers(
    *, cors: bool = False, methods: str | None = None
) -> dict[str, str]:
    headers = {"Cache-Control": "no-store", "Pragma": "no-cache"}
    if cors:
        headers.update(
            {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": (
                    "Authorization, Content-Type, MCP-Protocol-Version, "
                    "mcp-protocol-version"
                ),
                "Access-Control-Max-Age": "600",
            }
        )
        if methods:
            headers["Access-Control-Allow-Methods"] = methods
    return headers


def _cors_preflight(methods: str) -> Response:
    return Response(
        status_code=204, headers=_no_store_headers(cors=True, methods=methods)
    )


def _oauth_error_response(
    exc: OAuthFlowError, *, cors: bool = False, methods: str | None = None
) -> JSONResponse:
    headers = _no_store_headers(cors=cors, methods=methods)
    if exc.status_code == 401 and exc.error == "invalid_client":
        headers["WWW-Authenticate"] = 'Basic realm="supermemento"'
    return JSONResponse(
        {"error": exc.error, "error_description": exc.description},
        status_code=exc.status_code,
        headers=headers,
    )


def _json_no_store(
    data: dict,
    *,
    status_code: int = 200,
    cors: bool = False,
    methods: str | None = None,
) -> JSONResponse:
    return JSONResponse(
        data,
        status_code=status_code,
        headers=_no_store_headers(cors=cors, methods=methods),
    )


def _consent_page(pending: Any, *, error: str | None = None) -> HTMLResponse:
    escaped_client = GatewayOAuthManager.quote_html(pending.client_id)
    escaped_error = GatewayOAuthManager.quote_html(error)
    error_html = f'<p class="error">{escaped_error}</p>' if error else ""
    html = f"""<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Autorizar Supermemento</title>
  <style>
    body {{ font-family: -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif; margin: 2rem; line-height: 1.45; }}
    main {{ max-width: 34rem; margin: 0 auto; }}
    label {{ display: block; margin: 1rem 0 0.25rem; font-weight: 600; }}
    input {{ width: 100%; box-sizing: border-box; padding: 0.7rem; font-size: 1rem; }}
    button {{ margin-top: 1rem; padding: 0.7rem 1rem; font-size: 1rem; }}
    code {{ background: #f4f4f4; padding: 0.1rem 0.25rem; }}
    .notice {{ background: #f7f7ff; border: 1px solid #d8d8ff; padding: 1rem; border-radius: 0.5rem; }}
    .error {{ color: #9f1239; font-weight: 600; }}
  </style>
</head>
<body>
<main>
  <h1>Autorizar Supermemento</h1>
  <div class="notice">
    <p>Conecta ChatGPT con el conocimiento de Supermemento.</p>
    <p><strong>Cliente:</strong> <code>{escaped_client}</code></p>
  </div>
  {error_html}
  <form method="post" action="authorize" autocomplete="off">
    <input type="hidden" name="request_id" value="{GatewayOAuthManager.quote_html(pending.request_id)}">
    <input type="hidden" name="csrf_token" value="{GatewayOAuthManager.quote_html(pending.csrf_token)}">
    <label for="setup_token">Token de propietario</label>
    <input id="setup_token" name="setup_token" type="password" required autofocus>
    <button type="submit">Autorizar</button>
  </form>
</main>
</body>
</html>"""
    return HTMLResponse(
        html, headers={"Cache-Control": "no-store", "Pragma": "no-cache"}
    )


def _store_is_writable(store_path: str) -> bool:
    path = Path(store_path)
    directory = path.parent
    return directory.is_dir() and os.access(directory, os.W_OK | os.X_OK)


def create_gateway(
    settings: GatewaySettings,
    *,
    target: Any,
    auth_provider: Any,
    oauth_manager: GatewayOAuthManager,
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
            RateLimitingMiddleware(
                max_requests_per_second=5, burst_capacity=10, global_limit=True
            ),
            ResponseLimitingMiddleware(max_size=750_000),
        ],
        lifespan=lifespan,
        mask_error_details=True,
        strict_input_validation=True,
    )

    @gateway.custom_route(
        "/.well-known/oauth-authorization-server",
        methods=["GET", "OPTIONS"],
        include_in_schema=False,
    )
    async def oauth_authorization_server_metadata(request: Request) -> Response:
        methods = "GET, OPTIONS"
        if request.method == "OPTIONS":
            return _cors_preflight(methods)
        return _json_no_store(
            oauth_manager.authorization_server_metadata(),
            cors=True,
            methods=methods,
        )

    @gateway.custom_route(
        "/register", methods=["POST", "OPTIONS"], include_in_schema=False
    )
    async def oauth_register(request: Request) -> Response:
        methods = "POST, OPTIONS"
        if request.method == "OPTIONS":
            return _cors_preflight(methods)
        try:
            body = await request.json()
            if not isinstance(body, dict):
                raise OAuthFlowError(
                    "invalid_client_metadata",
                    "registration body must be a JSON object",
                )
            redirect_uris = body.get("redirect_uris")
            if not isinstance(redirect_uris, list) or not redirect_uris:
                raise OAuthFlowError(
                    "invalid_client_metadata",
                    "redirect_uris must include at least one URI",
                )
            if any(
                not isinstance(uri, str)
                or not client_redirect_uri_allowed(
                    uri, settings.allowed_client_redirect_uris
                )
                for uri in redirect_uris
            ):
                raise OAuthFlowError(
                    "invalid_redirect_uri", "redirect URI is not allowed"
                )
            return _json_no_store(
                oauth_manager.register_client(body),
                status_code=201,
                cors=True,
                methods=methods,
            )
        except OAuthFlowError as exc:
            return _oauth_error_response(exc, cors=True, methods=methods)
        except (json.JSONDecodeError, UnicodeDecodeError):
            return _oauth_error_response(
                OAuthFlowError(
                    "invalid_client_metadata", "registration body must be JSON"
                ),
                cors=True,
                methods=methods,
            )

    @gateway.custom_route(
        "/authorize", methods=["GET", "POST", "OPTIONS"], include_in_schema=False
    )
    async def oauth_authorize(request: Request) -> Response:
        methods = "GET, POST, OPTIONS"
        if request.method == "OPTIONS":
            return _cors_preflight(methods)
        try:
            if request.method == "GET":
                pending = oauth_manager.start_authorization(dict(request.query_params))
                return _consent_page(pending)
            form = GatewayOAuthManager.parse_form_body(await request.body())
            redirect_url = oauth_manager.complete_authorization(
                request_id=form.get("request_id", ""),
                csrf_token=form.get("csrf_token", ""),
                setup_token=form.get("setup_token", ""),
            )
            return RedirectResponse(
                redirect_url,
                status_code=302,
                headers={"Cache-Control": "no-store", "Pragma": "no-cache"},
            )
        except OAuthFlowError as exc:
            return _oauth_error_response(exc, cors=True, methods=methods)

    @gateway.custom_route(
        "/token", methods=["POST", "OPTIONS"], include_in_schema=False
    )
    async def oauth_token(request: Request) -> Response:
        methods = "POST, OPTIONS"
        if request.method == "OPTIONS":
            return _cors_preflight(methods)
        try:
            form = GatewayOAuthManager.parse_form_body(await request.body())
            return _json_no_store(
                oauth_manager.exchange_token(form, request.headers),
                cors=True,
                methods=methods,
            )
        except OAuthFlowError as exc:
            return _oauth_error_response(exc, cors=True, methods=methods)

    @gateway.custom_route("/health", methods=["GET"], include_in_schema=False)
    async def health(_request: Request) -> Response:
        return JSONResponse({"status": "ok"})

    @gateway.custom_route("/ready", methods=["GET"], include_in_schema=False)
    async def ready(_request: Request) -> Response:
        if (
            http_client is None
            or not oauth_manager.storage_healthy
            or not _store_is_writable(settings.oauth_store_path)
        ):
            return JSONResponse({"status": "unavailable"}, status_code=503)
        try:
            upstream = await http_client.get(settings.upstream_health_url)
            if upstream.status_code != 200:
                raise RuntimeError("dependency unavailable")
        except Exception:
            return JSONResponse({"status": "unavailable"}, status_code=503)
        return JSONResponse({"status": "ready"})

    return gateway


def build_production_gateway(settings: GatewaySettings):
    http_client = httpx.AsyncClient(
        timeout=httpx.Timeout(10.0),
        follow_redirects=False,
        headers={"User-Agent": "supermemento-chatgpt-gateway/1.0"},
    )
    oauth_manager = build_oauth_manager(settings)
    auth_provider = build_auth_provider(settings, oauth_manager)
    return create_gateway(
        settings,
        target=settings.upstream_mcp_url,
        auth_provider=auth_provider,
        oauth_manager=oauth_manager,
        http_client=http_client,
    )


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
    settings = GatewaySettings.from_env()
    try:
        gateway = build_production_gateway(settings)
    except OAuthStoreError:
        logger.exception("OAuth state could not be loaded")
        raise SystemExit(1) from None
    gateway.run(
        transport="http",
        host="0.0.0.0",
        port=settings.port,
        path="/mcp",
        stateless_http=True,
        json_response=True,
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
