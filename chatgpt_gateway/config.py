"""Fail-closed runtime configuration for the ChatGPT MCP gateway."""

from __future__ import annotations

from dataclasses import dataclass
from ipaddress import ip_address
import os
from pathlib import Path
from urllib.parse import urlparse

from cryptography.fernet import Fernet


_DEFAULT_REDIRECT = "https://chatgpt.com/connector_platform_oauth_redirect"
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


@dataclass(frozen=True, repr=False)
class GatewaySettings:
    """Validated settings. Secrets are intentionally excluded from repr."""

    public_base_url: str
    public_hostname: str
    upstream_mcp_url: str
    upstream_health_url: str
    github_client_id: str
    github_client_secret: str
    jwt_signing_key: str
    storage_encryption_key: str
    redis_host: str
    redis_port: int
    redis_db: int
    redis_password: str
    allowed_github_users: frozenset[str]
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
        github_client_id = os.getenv("GITHUB_OAUTH_CLIENT_ID", "").strip()
        if len(github_client_id) < 8:
            raise ValueError("GITHUB_OAUTH_CLIENT_ID is missing or too short")
        github_client_secret = _read_secret("GITHUB_OAUTH_CLIENT_SECRET", minimum=20)
        jwt_signing_key = _read_secret("MCP_GATEWAY_JWT_SIGNING_KEY", minimum=32)
        storage_encryption_key = _read_secret(
            "MCP_GATEWAY_STORAGE_ENCRYPTION_KEY", minimum=40
        )
        try:
            Fernet(storage_encryption_key.encode("ascii"))
        except (ValueError, UnicodeEncodeError) as exc:
            raise ValueError(
                "MCP_GATEWAY_STORAGE_ENCRYPTION_KEY is not a valid Fernet key"
            ) from exc
        redis_password = _read_secret("MCP_GATEWAY_REDIS_PASSWORD", minimum=24)
        allowed_users = frozenset(
            value.lower() for value in _csv("ALLOWED_GITHUB_USERS")
        )
        redirects = _csv("ALLOWED_CLIENT_REDIRECT_URIS", default=_DEFAULT_REDIRECT)
        for redirect in redirects:
            parsed = urlparse(redirect)
            if parsed.scheme != "https" or not parsed.hostname or parsed.fragment:
                raise ValueError(
                    "ALLOWED_CLIENT_REDIRECT_URIS must contain absolute HTTPS URLs"
                )
        try:
            redis_port = int(os.getenv("REDIS_PORT", "6379"))
            redis_db = int(os.getenv("REDIS_DB", "0"))
            port = int(os.getenv("PORT", "8080"))
        except ValueError as exc:
            raise ValueError("PORT, REDIS_PORT, and REDIS_DB must be integers") from exc
        if not 1 <= redis_port <= 65535 or not 1 <= port <= 65535 or redis_db < 0:
            raise ValueError("Invalid port or Redis database number")
        redis_host = os.getenv("REDIS_HOST", "supermemento-chatgpt-redis").strip()
        if not redis_host or "://" in redis_host:
            raise ValueError("REDIS_HOST must be a hostname, not a URL")
        return cls(
            public_base_url=public_base_url,
            public_hostname=public_hostname,
            upstream_mcp_url=upstream_mcp_url,
            upstream_health_url=upstream_health_url,
            github_client_id=github_client_id,
            github_client_secret=github_client_secret,
            jwt_signing_key=jwt_signing_key,
            storage_encryption_key=storage_encryption_key,
            redis_host=redis_host,
            redis_port=redis_port,
            redis_db=redis_db,
            redis_password=redis_password,
            allowed_github_users=allowed_users,
            allowed_client_redirect_uris=redirects,
            port=port,
        )
