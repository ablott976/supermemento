"""Fail-closed runtime configuration for the ChatGPT MCP gateway."""

from __future__ import annotations

from dataclasses import dataclass
from ipaddress import ip_address
import os
from pathlib import Path
import re
from urllib.parse import urlparse

CHATGPT_DYNAMIC_REDIRECT_PATTERN = "https://chatgpt.com/connector/oauth/{callback_id}"
CHATGPT_LEGACY_REDIRECT = "https://chatgpt.com/connector_platform_oauth_redirect"
_DEFAULT_REDIRECT = CHATGPT_LEGACY_REDIRECT
_CHATGPT_CALLBACK_ID = re.compile(r"[A-Za-z0-9_-]{1,256}")
_DEFAULT_INTERNAL_HOSTS = frozenset(
    {"n8n_supermemento", "n8n-supermemento", "supermemento", "localhost"}
)


def _read_secret(name: str, *, minimum: int = 1) -> str:
    file_value = os.getenv(f"{name}_FILE", "").strip()
    direct_value = os.getenv(name, "").strip()
    if file_value and direct_value:
        raise ValueError(f"Configure only one of {name} or {name}_FILE")
    if file_value:
        try:
            value = Path(file_value).read_text(encoding="utf-8").strip()
        except OSError as exc:
            raise ValueError(f"{name}_FILE cannot be read") from exc
    else:
        value = direct_value
    if len(value) < minimum:
        raise ValueError(f"{name} is missing or too short")
    return value


def _csv(name: str, *, default: str = "") -> tuple[str, ...]:
    values = tuple(
        item.strip() for item in os.getenv(name, default).split(",") if item.strip()
    )
    if not values:
        raise ValueError(f"{name} must contain at least one value")
    return values


def _validated_public_url(value: str) -> tuple[str, str]:
    parsed = urlparse(value)
    if parsed.scheme != "https" or not parsed.hostname:
        raise ValueError("PUBLIC_BASE_URL must be an absolute HTTPS URL")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError(
            "PUBLIC_BASE_URL must not contain credentials, query, or fragment"
        )
    if parsed.path not in {"", "/"}:
        raise ValueError("PUBLIC_BASE_URL must not contain a path")
    return value.rstrip("/"), parsed.hostname.lower()


def _validated_upstream(value: str, allowed_hosts: frozenset[str]) -> str:
    parsed = urlparse(value)
    host = (parsed.hostname or "").lower()
    if (
        parsed.scheme != "http"
        or parsed.path != "/mcp"
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError(
            "UPSTREAM_MCP_URL must be an internal HTTP URL ending exactly in /mcp"
        )
    if parsed.username or parsed.password:
        raise ValueError("UPSTREAM_MCP_URL must not contain credentials")
    is_allowed = host in allowed_hosts
    if not is_allowed:
        try:
            address = ip_address(host)
            is_allowed = address.is_private or address.is_loopback
        except ValueError:
            is_allowed = False
    if not is_allowed:
        raise ValueError("UPSTREAM_MCP_URL host is not an allowlisted internal host")
    return value.rstrip("/")


def _validated_sha256(value: str, name: str) -> str:
    normalized = value.lower()
    if len(normalized) != 64 or any(ch not in "0123456789abcdef" for ch in normalized):
        raise ValueError(f"{name} must be a SHA-256 hex digest")
    return normalized


def _validated_store_path(value: str) -> str:
    path = Path(value)
    if not path.is_absolute() or value.endswith("/"):
        raise ValueError("MCP_GATEWAY_OAUTH_STORE_PATH must be an absolute file path")
    return str(path)


def client_redirect_uri_allowed(uri: str, allowed_redirects: tuple[str, ...]) -> bool:
    """Match exact redirects or ChatGPT's tightly scoped dynamic callback."""
    if uri in allowed_redirects:
        return True
    if "?" in uri or "#" in uri:
        return False

    parsed = urlparse(uri)
    callback_prefix = "/connector/oauth/"
    if (
        parsed.scheme != "https"
        or parsed.netloc != "chatgpt.com"
        or parsed.username
        or parsed.password
        or parsed.params
        or parsed.query
        or parsed.fragment
        or not parsed.path.startswith(callback_prefix)
    ):
        return False
    callback_id = parsed.path.removeprefix(callback_prefix)
    return _CHATGPT_CALLBACK_ID.fullmatch(callback_id) is not None


@dataclass(frozen=True, repr=False)
class GatewaySettings:
    """Validated settings. Credential hashes are intentionally excluded from repr."""

    public_base_url: str
    public_hostname: str
    upstream_mcp_url: str
    upstream_health_url: str
    owner_token_sha256: str
    oauth_store_path: str
    allowed_client_redirect_uris: tuple[str, ...]
    port: int

    @classmethod
    def from_env(cls) -> "GatewaySettings":
        public_base_url, public_hostname = _validated_public_url(
            os.getenv(
                "PUBLIC_BASE_URL",
                "https://n8n-supermemento-chatgpt.9kpuqs.easypanel.host",
            ).strip()
        )
        allowed_internal_hosts = frozenset(
            value.lower()
            for value in _csv(
                "UPSTREAM_ALLOWED_HOSTS",
                default=",".join(sorted(_DEFAULT_INTERNAL_HOSTS)),
            )
        )
        upstream_mcp_url = _validated_upstream(
            os.getenv("UPSTREAM_MCP_URL", "http://n8n_supermemento:80/mcp").strip(),
            allowed_internal_hosts,
        )
        upstream_health_url = upstream_mcp_url.removesuffix("/mcp") + "/health"
        owner_token_sha256 = _validated_sha256(
            _read_secret("MCP_GATEWAY_OWNER_TOKEN_SHA256", minimum=64),
            "MCP_GATEWAY_OWNER_TOKEN_SHA256",
        )
        oauth_store_path = _validated_store_path(
            os.getenv("MCP_GATEWAY_OAUTH_STORE_PATH", "/data/oauth-store.json").strip()
        )
        redirects = _csv("ALLOWED_CLIENT_REDIRECT_URIS", default=_DEFAULT_REDIRECT)
        for redirect in redirects:
            parsed = urlparse(redirect)
            if (
                parsed.scheme != "https"
                or not parsed.hostname
                or parsed.username
                or parsed.password
                or parsed.query
                or parsed.fragment
            ):
                raise ValueError(
                    "ALLOWED_CLIENT_REDIRECT_URIS must contain absolute HTTPS URLs"
                )
        try:
            port = int(os.getenv("PORT", "8080"))
        except ValueError as exc:
            raise ValueError("PORT must be an integer") from exc
        if not 1 <= port <= 65535:
            raise ValueError("Invalid port")
        return cls(
            public_base_url=public_base_url,
            public_hostname=public_hostname,
            upstream_mcp_url=upstream_mcp_url,
            upstream_health_url=upstream_health_url,
            owner_token_sha256=owner_token_sha256,
            oauth_store_path=oauth_store_path,
            allowed_client_redirect_uris=redirects,
            port=port,
        )
