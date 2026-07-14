#!/usr/bin/env python3
"""Authenticated, narrow relay from Supermemento to Hermes-managed Codex OAuth."""

from __future__ import annotations

import argparse
import asyncio
import base64
import hmac
import importlib
import json
import logging
import os
from typing import Any

from aiohttp import ClientError, ClientSession, ClientTimeout, web

LOGGER = logging.getLogger("supermemento.codex_relay")
MAX_REQUEST_BYTES = 2_000_000
UPSTREAM_CONNECT_SECONDS = 15
UPSTREAM_READ_SECONDS = 300


def is_authorized(header: str | None, expected_key: str) -> bool:
    if not header or not header.startswith("Bearer "):
        return False
    supplied = header[len("Bearer ") :].strip()
    return bool(supplied) and hmac.compare_digest(supplied, expected_key)


def validate_payload(payload: Any, allowed_model: str) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("request body must be a JSON object")
    if payload.get("model") != allowed_model:
        raise ValueError("model is not allowed")
    if payload.get("stream") is not True:
        raise ValueError("stream=true is required")
    if payload.get("store") is not False:
        raise ValueError("store=false is required")
    if "input" not in payload:
        raise ValueError("input is required")
    if "tools" in payload:
        raise ValueError("tools are not allowed")
    if "previous_response_id" in payload:
        raise ValueError("previous_response_id is not allowed")
    if payload.get("background") not in (None, False):
        raise ValueError("background responses are not allowed")
    if "max_output_tokens" in payload:
        raise ValueError("max_output_tokens is not supported by the Codex OAuth backend")
    allowed_keys = {"model", "instructions", "input", "store", "stream", "reasoning"}
    if set(payload) - allowed_keys:
        raise ValueError("request contains unsupported fields")
    if not isinstance(payload.get("instructions"), str):
        raise ValueError("instructions must be a string")
    items = payload.get("input")
    if not isinstance(items, list) or len(items) != 1 or not isinstance(items[0], dict):
        raise ValueError("input must contain one user message")
    item = items[0]
    if item.get("role") != "user" or set(item) != {"role", "content"}:
        raise ValueError("input must contain one user message")
    content = item.get("content")
    if not isinstance(content, list) or len(content) != 1 or not isinstance(content[0], dict):
        raise ValueError("input content must contain one text part")
    part = content[0]
    if set(part) != {"type", "text"} or part.get("type") != "input_text" or not isinstance(part.get("text"), str):
        raise ValueError("input content must contain one text part")
    reasoning = payload.get("reasoning")
    if reasoning is not None:
        if not isinstance(reasoning, dict) or set(reasoning) - {"effort", "summary"}:
            raise ValueError("reasoning configuration is invalid")
        if reasoning.get("effort") not in {"low", "medium", "high"}:
            raise ValueError("reasoning effort is invalid")
        if reasoning.get("summary") not in {None, "auto"}:
            raise ValueError("reasoning summary is invalid")
    return payload


def _jwt_account_id(access_token: str) -> str | None:
    try:
        parts = access_token.split(".")
        if len(parts) < 2:
            return None
        encoded = parts[1] + "=" * (-len(parts[1]) % 4)
        claims = json.loads(base64.urlsafe_b64decode(encoded))
        account_id = claims.get("https://api.openai.com/auth", {}).get("chatgpt_account_id")
        return account_id if isinstance(account_id, str) and account_id else None
    except Exception:
        return None


def codex_headers(access_token: str) -> dict[str, str]:
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
        "User-Agent": "codex_cli_rs/0.0.0 (Supermemento OAuth Relay)",
        "originator": "codex_cli_rs",
    }
    account_id = _jwt_account_id(access_token)
    if account_id:
        headers["ChatGPT-Account-ID"] = account_id
    return headers


def sanitize_upstream_error(status: int, _body: str = "") -> dict[str, Any]:
    return {
        "error": {
            "type": "upstream_error",
            "message": f"Codex upstream failed (HTTP {status})",
        }
    }


def resolve_credentials(*, force_refresh: bool = False) -> dict[str, Any]:
    auth_module = importlib.import_module("hermes_cli.auth")
    resolver = auth_module.resolve_codex_runtime_credentials
    return resolver(
        force_refresh=force_refresh,
        refresh_if_expiring=True,
    )


async def health(_request: web.Request) -> web.Response:
    return web.json_response({"status": "ok"})


async def responses(request: web.Request) -> web.StreamResponse:
    relay_key: str = request.app["relay_key"]
    allowed_model: str = request.app["allowed_model"]
    if not is_authorized(request.headers.get("Authorization"), relay_key):
        return web.json_response(
            {"error": {"type": "authentication_error", "message": "Unauthorized"}},
            status=401,
        )

    try:
        payload = validate_payload(await request.json(), allowed_model)
    except (json.JSONDecodeError, ValueError, web.HTTPBadRequest) as error:
        return web.json_response(
            {"error": {"type": "invalid_request", "message": str(error)}},
            status=400,
        )

    body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    timeout = ClientTimeout(
        total=None,
        sock_connect=UPSTREAM_CONNECT_SECONDS,
        sock_read=UPSTREAM_READ_SECONDS,
    )

    try:
        async with ClientSession(timeout=timeout) as session:
            upstream_response = None
            for force_refresh in (False, True):
                credentials = await asyncio.to_thread(
                    resolve_credentials,
                    force_refresh=force_refresh,
                )
                token = str(credentials.get("api_key") or "").strip()
                base_url = str(credentials.get("base_url") or "").strip().rstrip("/")
                if not token or not base_url:
                    raise RuntimeError("Codex OAuth credentials are unavailable")
                upstream_response = await session.post(
                    f"{base_url}/responses",
                    data=body,
                    headers=codex_headers(token),
                    allow_redirects=False,
                )
                if upstream_response.status != 401 or force_refresh:
                    break
                await upstream_response.read()
                upstream_response.release()

            assert upstream_response is not None
            if upstream_response.status >= 400:
                await upstream_response.read()
                result = sanitize_upstream_error(upstream_response.status)
                upstream_response.release()
                return web.json_response(result, status=upstream_response.status)

            downstream = web.StreamResponse(
                status=upstream_response.status,
                headers={
                    "Content-Type": upstream_response.headers.get(
                        "Content-Type", "text/event-stream"
                    ),
                    "Cache-Control": "no-cache",
                    "X-Accel-Buffering": "no",
                },
            )
            await downstream.prepare(request)
            try:
                async for chunk in upstream_response.content.iter_any():
                    if chunk:
                        await downstream.write(chunk)
                await downstream.write_eof()
                return downstream
            except (ConnectionResetError, asyncio.CancelledError):
                return downstream
            finally:
                upstream_response.release()
    except (ClientError, TimeoutError):
        LOGGER.warning("Codex upstream unavailable")
        return web.json_response(sanitize_upstream_error(502), status=502)
    except Exception:
        LOGGER.error("Codex relay request failed")
        return web.json_response(
            {"error": {"type": "relay_error", "message": "Codex relay failed"}},
            status=500,
        )


def create_app(relay_key: str, allowed_model: str) -> web.Application:
    if len(relay_key) < 32:
        raise ValueError("SUPERMEMENTO_CODEX_RELAY_KEY must contain at least 32 characters")
    app = web.Application(client_max_size=MAX_REQUEST_BYTES)
    app["relay_key"] = relay_key
    app["allowed_model"] = allowed_model
    app.router.add_get("/health", health)
    app.router.add_post("/v1/responses", responses)
    return app


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default=os.environ.get("SUPERMEMENTO_CODEX_RELAY_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("SUPERMEMENTO_CODEX_RELAY_PORT", "8646")))
    return parser.parse_args()


def main() -> None:
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))
    args = parse_args()
    relay_key = os.environ.get("SUPERMEMENTO_CODEX_RELAY_KEY", "")
    model = os.environ.get("SUPERMEMENTO_CODEX_MODEL", "gpt-5.6-luna")
    web.run_app(
        create_app(relay_key, model),
        host=args.host,
        port=args.port,
        access_log=None,
        print=None,
    )


if __name__ == "__main__":
    main()
