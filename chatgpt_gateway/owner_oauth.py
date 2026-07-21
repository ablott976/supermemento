"""Self-hosted OAuth 2.0 + PKCE provider for the Supermemento MCP gateway.

This is adapted from the production ChatGPT ↔ Hermes MCP gateway. OAuth
enrollment is gated by an owner/setup token whose SHA-256 hash is the only
credential persisted by the service. Raw authorization codes and access and
refresh tokens are also persisted only as hashes.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import tempfile
import time
from dataclasses import asdict, dataclass, fields, replace
from typing import Iterable, Mapping, TypeVar
from urllib.parse import parse_qs, quote, urlencode, urlparse, urlunparse

from mcp.server.auth.provider import AccessToken


PUBLIC_SCOPES = ("supermemento:access",)


def sha256_token(token: str) -> str:
    """Return the lowercase SHA-256 hex digest for a bearer token."""

    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def is_sha256_hex(value: str) -> bool:
    return len(value) == 64 and all(ch in "0123456789abcdefABCDEF" for ch in value)


def require_scopes(granted: Iterable[str], required: Iterable[str]) -> bool:
    return set(required).issubset(set(granted))


@dataclass(frozen=True)
class GatewayBearerVerifier:
    """MCP TokenVerifier implementation that never stores raw public tokens."""

    token_sha256: str
    token_id: str = "chatgpt"
    scopes: tuple[str, ...] = PUBLIC_SCOPES

    def __post_init__(self) -> None:
        if not is_sha256_hex(self.token_sha256):
            raise ValueError("token_sha256 must be a 64-character SHA-256 hex digest")

    async def verify_token(self, token: str) -> AccessToken | None:
        candidate_hash = sha256_token(token)
        if not hmac.compare_digest(candidate_hash.lower(), self.token_sha256.lower()):
            return None
        return AccessToken(
            token=self.token_sha256[:12],
            client_id=self.token_id,
            scopes=list(self.scopes),
        )


class OAuthFlowError(Exception):
    """OAuth error that can be serialized safely without secrets."""

    def __init__(self, error: str, description: str, *, status_code: int = 400) -> None:
        super().__init__(description)
        self.error = error
        self.description = description
        self.status_code = status_code


class OAuthStoreError(OAuthFlowError):
    """Safe OAuth error for unreadable or unsafe persistence-store state."""

    def __init__(
        self, description: str = "OAuth persistence store is unavailable"
    ) -> None:
        super().__init__("temporarily_unavailable", description, status_code=503)


class JsonOAuthStore:
    """Small local JSON store for hash-only OAuth state.

    The store never receives raw access tokens, refresh tokens, authorization
    codes, client secrets, public bearer tokens, setup tokens, node tokens, or
    Authorization headers. Only client metadata and token/code hashes are
    persisted so a single-container redeploy can keep ChatGPT's registered
    OAuth client and refresh/access tokens valid.
    """

    VERSION = 1

    def __init__(self, path: str) -> None:
        if not path or "\x00" in path:
            raise OAuthStoreError("OAuth store path is invalid")
        self.path = os.path.abspath(os.path.expanduser(path))

    def load(self) -> dict:
        if not os.path.exists(self.path):
            return {"version": self.VERSION}
        if os.path.isdir(self.path):
            raise OAuthStoreError("OAuth store path must be a file, not a directory")
        try:
            with open(self.path, "r", encoding="utf-8") as handle:
                data = json.load(handle)
        except json.JSONDecodeError as exc:
            raise OAuthStoreError("OAuth store file is not valid JSON") from exc
        except OSError as exc:
            raise OAuthStoreError("OAuth store file could not be read") from exc
        if not isinstance(data, dict):
            raise OAuthStoreError("OAuth store JSON root must be an object")
        version = data.get("version", self.VERSION)
        if version != self.VERSION:
            raise OAuthStoreError("OAuth store version is not supported")
        self._harden_mode_if_possible()
        return data

    def save(self, snapshot: Mapping[str, object]) -> None:
        directory = os.path.dirname(self.path) or "."
        try:
            os.makedirs(directory, mode=0o700, exist_ok=True)
        except OSError as exc:
            raise OAuthStoreError("OAuth store directory could not be created") from exc
        basename = os.path.basename(self.path) or "oauth-store.json"
        tmp_path = ""
        try:
            fd, tmp_path = tempfile.mkstemp(
                prefix=f".{basename}.", suffix=".tmp", dir=directory
            )
            try:
                os.fchmod(fd, 0o600)
            except OSError:
                pass
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(dict(snapshot), handle, sort_keys=True, separators=(",", ":"))
                handle.write("\n")
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(tmp_path, self.path)
            self._harden_mode_if_possible()
            directory_fd = os.open(
                directory, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
            )
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
            tmp_path = ""
        except OSError as exc:
            if tmp_path:
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass
            raise OAuthStoreError("OAuth store file could not be written") from exc

    def _harden_mode_if_possible(self) -> None:
        try:
            os.chmod(self.path, 0o600)
        except OSError:
            pass


@dataclass(frozen=True)
class OAuthClientRecord:
    client_id: str
    redirect_uris: tuple[str, ...]
    token_endpoint_auth_method: str
    grant_types: tuple[str, ...]
    response_types: tuple[str, ...]
    scopes: tuple[str, ...]
    client_secret_hash: str | None
    client_name: str | None
    issued_at: int
    authorized_at: int | None = None


@dataclass(frozen=True)
class PendingAuthorizationRecord:
    request_id: str
    csrf_token: str
    client_id: str
    redirect_uri: str
    scopes: tuple[str, ...]
    code_challenge: str
    state: str | None
    resource: str | None
    expires_at: float


@dataclass(frozen=True)
class AuthorizationCodeRecord:
    code_hash: str
    client_id: str
    redirect_uri: str
    scopes: tuple[str, ...]
    code_challenge: str
    state: str | None
    resource: str | None
    expires_at: float


@dataclass(frozen=True)
class OAuthAccessTokenRecord:
    token_hash: str
    client_id: str
    scopes: tuple[str, ...]
    resource: str | None
    expires_at: float


@dataclass(frozen=True)
class OAuthRefreshTokenRecord:
    token_hash: str
    client_id: str
    scopes: tuple[str, ...]
    resource: str | None
    expires_at: float


_RecordT = TypeVar("_RecordT")


def _record_to_mapping(record: object) -> dict:
    data = asdict(record)
    for key, value in list(data.items()):
        if isinstance(value, tuple):
            data[key] = list(value)
    return data


def _record_from_mapping(record_type: type[_RecordT], data: object) -> _RecordT:
    if not isinstance(data, Mapping):
        raise OAuthStoreError("OAuth store record must be an object")
    kwargs = {}
    for field in fields(record_type):
        if field.name not in data:
            raise OAuthStoreError(f"OAuth store record is missing field: {field.name}")
        value = data[field.name]
        if field.name in {"redirect_uris", "grant_types", "response_types", "scopes"}:
            if isinstance(value, str):
                value = (value,)
            elif isinstance(value, Iterable):
                value = tuple(str(part) for part in value)
            else:
                raise OAuthStoreError(
                    f"OAuth store tuple field is invalid: {field.name}"
                )
        kwargs[field.name] = value
    return record_type(**kwargs)


class GatewayOAuthManager:
    """Small OAuth provider plus MCP TokenVerifier.

    This intentionally avoids persistent raw-token storage. It is a protocol
    adapter for ChatGPT's OAuth-capable MCP connector, not a general SaaS auth
    system. When ``oauth_store_path`` is configured, client registrations,
    authorization-code hashes, access-token hashes, and refresh-token hashes are
    persisted so a single EasyPanel container redeploy does not force connector
    recreation.
    """

    _SUPPORTED_TOKEN_AUTH_METHODS = {
        "none",
        "client_secret_post",
        "client_secret_basic",
    }

    def __init__(
        self,
        *,
        issuer_url: str,
        resource_url: str,
        legacy_token_sha256: str | None = None,
        legacy_token_id: str = "chatgpt",
        consent_token_sha256: str | None = None,
        consent_token_sha256s: tuple[str, ...] | None = None,
        scopes: tuple[str, ...] = PUBLIC_SCOPES,
        authorization_code_ttl_seconds: int = 300,
        pending_authorization_ttl_seconds: int = 600,
        access_token_ttl_seconds: int = 3600,
        refresh_token_ttl_seconds: int = 30 * 24 * 3600,
        max_clients: int = 64,
        max_pending_authorizations: int = 64,
        max_access_tokens: int = 512,
        max_refresh_tokens: int = 512,
        cleanup_interval_seconds: int = 60,
        oauth_store_path: str | None = None,
    ) -> None:
        if legacy_token_sha256 is not None and not is_sha256_hex(legacy_token_sha256):
            raise ValueError("legacy_token_sha256 must be a SHA-256 hex digest")
        configured_consent_hashes = tuple(
            dict.fromkeys(
                hash_value.lower()
                for hash_value in (
                    *(
                        (consent_token_sha256,)
                        if consent_token_sha256 is not None
                        else ()
                    ),
                    *(consent_token_sha256s or ()),
                )
            )
        )
        for hash_value in configured_consent_hashes:
            if not is_sha256_hex(hash_value):
                raise ValueError("consent token hashes must be SHA-256 hex digests")
        if not scopes:
            raise ValueError("at least one OAuth scope is required")

        self.issuer_base_url = issuer_url.rstrip("/")
        self.issuer_url = (
            self.issuer_base_url + "/"
            if "/"
            not in self.issuer_base_url.removeprefix("https://").removeprefix("http://")
            else self.issuer_base_url
        )
        self.resource_url = resource_url
        self.legacy_token_sha256 = (
            legacy_token_sha256.lower() if legacy_token_sha256 is not None else None
        )
        self.legacy_token_id = legacy_token_id
        fallback_consent_hashes = (
            (self.legacy_token_sha256,) if self.legacy_token_sha256 is not None else ()
        )
        self.consent_token_sha256s = (
            configured_consent_hashes or fallback_consent_hashes
        )
        if not self.consent_token_sha256s:
            raise ValueError("at least one consent token hash is required")
        self.consent_token_sha256 = self.consent_token_sha256s[0]
        self.scopes = tuple(scopes)
        # RemoteAuthProvider reads this attribute from its TokenVerifier contract.
        self.required_scopes = list(self.scopes)
        self.authorization_code_ttl_seconds = authorization_code_ttl_seconds
        self.pending_authorization_ttl_seconds = pending_authorization_ttl_seconds
        self.access_token_ttl_seconds = access_token_ttl_seconds
        self.refresh_token_ttl_seconds = refresh_token_ttl_seconds
        self.max_clients = max_clients
        self.max_pending_authorizations = max_pending_authorizations
        self.max_access_tokens = max_access_tokens
        self.max_refresh_tokens = max_refresh_tokens
        self.cleanup_interval_seconds = cleanup_interval_seconds
        self._last_cleanup_at = 0.0

        self._clients: dict[str, OAuthClientRecord] = {}
        self._pending_authorizations: dict[str, PendingAuthorizationRecord] = {}
        self._authorization_codes: dict[str, AuthorizationCodeRecord] = {}
        self._access_tokens: dict[str, OAuthAccessTokenRecord] = {}
        self._refresh_tokens: dict[str, OAuthRefreshTokenRecord] = {}
        self._storage_failed = False
        self._oauth_store = (
            JsonOAuthStore(oauth_store_path) if oauth_store_path else None
        )
        if self._oauth_store is not None:
            self._restore_oauth_state(self._oauth_store.load())
            self._cleanup_expired(force=True)

    def _restore_oauth_state(self, snapshot: Mapping[str, object]) -> None:
        self._clients = self._load_records(
            snapshot, "clients", OAuthClientRecord, "client_id"
        )
        self._authorization_codes = self._load_records(
            snapshot,
            "authorization_codes",
            AuthorizationCodeRecord,
            "code_hash",
        )
        self._access_tokens = self._load_records(
            snapshot, "access_tokens", OAuthAccessTokenRecord, "token_hash"
        )
        self._refresh_tokens = self._load_records(
            snapshot, "refresh_tokens", OAuthRefreshTokenRecord, "token_hash"
        )
        for client in self._clients.values():
            self._validate_loaded_client(client)
        for record in (
            *self._authorization_codes.values(),
            *self._access_tokens.values(),
            *self._refresh_tokens.values(),
        ):
            self._validate_loaded_scopes(record.scopes)

    def _load_records(
        self,
        snapshot: Mapping[str, object],
        key: str,
        record_type: type[_RecordT],
        id_field: str,
    ) -> dict[str, _RecordT]:
        raw_records = snapshot.get(key, {})
        if raw_records in (None, ""):
            return {}
        if isinstance(raw_records, Mapping):
            iterable = raw_records.values()
        elif isinstance(raw_records, Iterable) and not isinstance(
            raw_records, (str, bytes)
        ):
            iterable = raw_records
        else:
            raise OAuthStoreError(f"OAuth store section is invalid: {key}")
        records: dict[str, _RecordT] = {}
        for raw_record in iterable:
            record = _record_from_mapping(record_type, raw_record)
            record_id = getattr(record, id_field)
            if not isinstance(record_id, str) or not record_id:
                raise OAuthStoreError(f"OAuth store record id is invalid: {key}")
            records[record_id] = record
        return records

    def _validate_loaded_client(self, client: OAuthClientRecord) -> None:
        if client.token_endpoint_auth_method not in self._SUPPORTED_TOKEN_AUTH_METHODS:
            raise OAuthStoreError("OAuth store contains unsupported client auth method")
        if (
            "authorization_code" not in client.grant_types
            or "refresh_token" not in client.grant_types
        ):
            raise OAuthStoreError("OAuth store client is missing required grant types")
        if "code" not in client.response_types:
            raise OAuthStoreError("OAuth store client is missing code response type")
        self._validate_loaded_scopes(client.scopes)
        for redirect_uri in client.redirect_uris:
            self._validate_redirect_uri(redirect_uri)
        if client.client_secret_hash is not None and not is_sha256_hex(
            client.client_secret_hash
        ):
            raise OAuthStoreError("OAuth store client secret hash is invalid")

    def _validate_loaded_scopes(self, scopes: tuple[str, ...]) -> None:
        if not set(scopes).issubset(set(self.scopes)):
            raise OAuthStoreError(
                "OAuth store contains scopes outside current gateway policy"
            )

    @property
    def storage_healthy(self) -> bool:
        return not self._storage_failed

    def _require_storage_healthy(self) -> None:
        if self._storage_failed:
            raise OAuthStoreError("OAuth persistence durability is unavailable")

    def _persist_oauth_state(self) -> None:
        if self._oauth_store is None:
            return
        self._require_storage_healthy()
        try:
            self._oauth_store.save(
                {
                    "version": JsonOAuthStore.VERSION,
                    "saved_at": int(time.time()),
                    "clients": {
                        key: _record_to_mapping(value)
                        for key, value in sorted(self._clients.items())
                    },
                    "authorization_codes": {
                        key: _record_to_mapping(value)
                        for key, value in sorted(self._authorization_codes.items())
                    },
                    "access_tokens": {
                        key: _record_to_mapping(value)
                        for key, value in sorted(self._access_tokens.items())
                    },
                    "refresh_tokens": {
                        key: _record_to_mapping(value)
                        for key, value in sorted(self._refresh_tokens.items())
                    },
                }
            )
        except OAuthStoreError:
            self._storage_failed = True
            raise

    def authorization_server_metadata(self) -> dict:
        """Return OAuth authorization server metadata for ChatGPT discovery."""

        return {
            "issuer": self.issuer_url,
            "authorization_endpoint": f"{self.issuer_base_url}/authorize",
            "token_endpoint": f"{self.issuer_base_url}/token",
            "registration_endpoint": f"{self.issuer_base_url}/register",
            "scopes_supported": list(self.scopes),
            "response_types_supported": ["code"],
            "grant_types_supported": ["authorization_code", "refresh_token"],
            "token_endpoint_auth_methods_supported": sorted(
                self._SUPPORTED_TOKEN_AUTH_METHODS
            ),
            "code_challenge_methods_supported": ["S256"],
            "service_documentation": self.issuer_url,
        }

    def register_client(self, metadata: Mapping[str, object]) -> dict:
        """Register a ChatGPT OAuth client using dynamic client registration."""

        self._require_storage_healthy()
        self._cleanup_expired()
        redirect_uris = self._string_tuple(metadata.get("redirect_uris"))
        if not redirect_uris:
            raise OAuthFlowError(
                "invalid_client_metadata", "redirect_uris must include at least one URI"
            )
        for redirect_uri in redirect_uris:
            self._validate_redirect_uri(redirect_uri)

        token_auth_method = str(metadata.get("token_endpoint_auth_method") or "none")
        if token_auth_method not in self._SUPPORTED_TOKEN_AUTH_METHODS:
            raise OAuthFlowError(
                "invalid_client_metadata",
                f"unsupported token_endpoint_auth_method: {token_auth_method}",
            )

        grant_types = self._string_tuple(metadata.get("grant_types")) or (
            "authorization_code",
            "refresh_token",
        )
        if not {"authorization_code", "refresh_token"}.issubset(set(grant_types)):
            raise OAuthFlowError(
                "invalid_client_metadata",
                "grant_types must include authorization_code and refresh_token",
            )

        response_types = self._string_tuple(metadata.get("response_types")) or ("code",)
        if "code" not in response_types:
            raise OAuthFlowError(
                "invalid_client_metadata", "response_types must include code"
            )

        scopes = self._validate_scope(str(metadata.get("scope") or ""))
        self._reserve_client_slot()
        client_id = "ghmcp_client_" + secrets.token_urlsafe(24)
        client_secret = (
            None if token_auth_method == "none" else secrets.token_urlsafe(32)
        )
        issued_at = int(time.time())
        client_name = metadata.get("client_name")
        record = OAuthClientRecord(
            client_id=client_id,
            redirect_uris=redirect_uris,
            token_endpoint_auth_method=token_auth_method,
            grant_types=grant_types,
            response_types=response_types,
            scopes=scopes,
            client_secret_hash=sha256_token(client_secret) if client_secret else None,
            client_name=str(client_name) if client_name else None,
            issued_at=issued_at,
        )
        self._clients[client_id] = record
        self._persist_oauth_state()
        response = {
            "client_id": client_id,
            "client_id_issued_at": issued_at,
            "redirect_uris": list(redirect_uris),
            "token_endpoint_auth_method": token_auth_method,
            "grant_types": list(grant_types),
            "response_types": list(response_types),
            "scope": " ".join(scopes),
        }
        if client_secret is not None:
            response["client_secret"] = client_secret
        if record.client_name:
            response["client_name"] = record.client_name
        return response

    def start_authorization(
        self, params: Mapping[str, str]
    ) -> PendingAuthorizationRecord:
        """Validate an authorization request and create a pending consent record."""

        self._require_storage_healthy()
        self._cleanup_expired()
        if params.get("response_type") != "code":
            raise OAuthFlowError(
                "unsupported_response_type", "response_type must be code"
            )
        if params.get("code_challenge_method", "S256") != "S256":
            raise OAuthFlowError(
                "invalid_request", "code_challenge_method must be S256"
            )
        code_challenge = (params.get("code_challenge") or "").strip()
        if not code_challenge:
            raise OAuthFlowError("invalid_request", "code_challenge is required")

        client = self._require_client(params.get("client_id"))
        redirect_uri = self._resolve_redirect_uri(client, params.get("redirect_uri"))
        scopes = self._validate_scope(
            params.get("scope") or " ".join(client.scopes), allowed=client.scopes
        )
        resource = params.get("resource") or None
        if resource and resource.rstrip("/") != self.resource_url.rstrip("/"):
            raise OAuthFlowError(
                "invalid_request", "resource does not match this MCP endpoint"
            )

        pending = PendingAuthorizationRecord(
            request_id="ghmcp_req_" + secrets.token_urlsafe(24),
            csrf_token=secrets.token_urlsafe(24),
            client_id=client.client_id,
            redirect_uri=redirect_uri,
            scopes=scopes,
            code_challenge=code_challenge,
            state=params.get("state") or None,
            resource=resource,
            expires_at=time.time() + self.pending_authorization_ttl_seconds,
        )
        self._pending_authorizations[pending.request_id] = pending
        self._enforce_pending_limit()
        return pending

    def complete_authorization(
        self, *, request_id: str, csrf_token: str, setup_token: str
    ) -> str:
        """Validate owner consent and return the client redirect URI with code."""

        self._require_storage_healthy()
        self._cleanup_expired()
        pending = self._pending_authorizations.get(request_id)
        if pending is None or pending.expires_at < time.time():
            self._pending_authorizations.pop(request_id, None)
            raise OAuthFlowError(
                "invalid_request",
                "authorization request expired or not found",
                status_code=400,
            )
        if not hmac.compare_digest(csrf_token.encode(), pending.csrf_token.encode()):
            raise OAuthFlowError(
                "invalid_request", "invalid authorization form token", status_code=400
            )
        setup_token_hash = sha256_token(setup_token).lower()
        if not any(
            hmac.compare_digest(setup_token_hash, token_hash)
            for token_hash in self.consent_token_sha256s
        ):
            raise OAuthFlowError(
                "access_denied", "owner setup token was not accepted", status_code=403
            )

        client = self._clients.get(pending.client_id)
        if client is None:
            raise OAuthFlowError("invalid_request", "client_id is not registered")
        self._clients[pending.client_id] = replace(
            client, authorized_at=int(time.time())
        )

        self._pending_authorizations.pop(request_id, None)
        raw_code = "ghmcp_code_" + secrets.token_urlsafe(32)
        code = AuthorizationCodeRecord(
            code_hash=sha256_token(raw_code),
            client_id=pending.client_id,
            redirect_uri=pending.redirect_uri,
            scopes=pending.scopes,
            code_challenge=pending.code_challenge,
            state=pending.state,
            resource=pending.resource,
            expires_at=time.time() + self.authorization_code_ttl_seconds,
        )
        self._authorization_codes[code.code_hash] = code
        self._persist_oauth_state()
        query = {"code": raw_code}
        if pending.state is not None:
            query["state"] = pending.state
        return self._append_query(pending.redirect_uri, query)

    def exchange_token(
        self, form: Mapping[str, str], headers: Mapping[str, str]
    ) -> dict:
        """Handle the OAuth /token endpoint."""

        self._require_storage_healthy()
        grant_type = form.get("grant_type")
        if grant_type == "authorization_code":
            return self._exchange_authorization_code(form, headers)
        if grant_type == "refresh_token":
            return self._exchange_refresh_token(form, headers)
        raise OAuthFlowError(
            "unsupported_grant_type",
            "grant_type must be authorization_code or refresh_token",
        )

    async def verify_token(self, token: str) -> AccessToken | None:
        """Verify a legacy public bearer or OAuth-issued access token."""

        if not self.storage_healthy:
            return None
        candidate_hash = sha256_token(token).lower()
        if self.legacy_token_sha256 is not None and hmac.compare_digest(
            candidate_hash, self.legacy_token_sha256
        ):
            return AccessToken(
                token=self.legacy_token_sha256[:12],
                client_id=self.legacy_token_id,
                scopes=list(self.scopes),
                resource=self.resource_url,
            )

        self._cleanup_expired()
        record = self._access_tokens.get(candidate_hash)
        if record is None:
            return None
        if record.expires_at < time.time():
            self._access_tokens.pop(candidate_hash, None)
            self._persist_oauth_state()
            return None
        return AccessToken(
            token=record.token_hash[:12],
            client_id=record.client_id,
            scopes=list(record.scopes),
            expires_at=int(record.expires_at),
            resource=record.resource,
        )

    def _exchange_authorization_code(
        self, form: Mapping[str, str], headers: Mapping[str, str]
    ) -> dict:
        client = self._authenticate_client(form, headers)
        raw_code = form.get("code") or ""
        code_hash = sha256_token(raw_code)
        code = self._authorization_codes.get(code_hash)
        if code is None:
            raise OAuthFlowError(
                "invalid_grant", "authorization code does not exist or has expired"
            )
        if code.expires_at < time.time():
            self._authorization_codes.pop(code_hash, None)
            self._persist_oauth_state()
            raise OAuthFlowError(
                "invalid_grant", "authorization code does not exist or has expired"
            )
        if code.client_id != client.client_id:
            raise OAuthFlowError(
                "invalid_grant", "authorization code does not exist or has expired"
            )
        redirect_uri = form.get("redirect_uri") or None
        if redirect_uri != code.redirect_uri:
            raise OAuthFlowError(
                "invalid_request",
                "redirect_uri did not match the authorization request",
            )
        verifier = form.get("code_verifier") or ""
        if self._pkce_s256(verifier) != code.code_challenge:
            raise OAuthFlowError("invalid_grant", "incorrect code_verifier")
        self._authorization_codes.pop(code_hash, None)
        return self._issue_token_pair(
            client_id=client.client_id, scopes=code.scopes, resource=code.resource
        )

    def _exchange_refresh_token(
        self, form: Mapping[str, str], headers: Mapping[str, str]
    ) -> dict:
        client = self._authenticate_client(form, headers)
        raw_refresh = form.get("refresh_token") or ""
        refresh_hash = sha256_token(raw_refresh)
        refresh = self._refresh_tokens.get(refresh_hash)
        if refresh is None:
            raise OAuthFlowError(
                "invalid_grant", "refresh token does not exist or has expired"
            )
        if refresh.expires_at < time.time():
            self._refresh_tokens.pop(refresh_hash, None)
            self._persist_oauth_state()
            raise OAuthFlowError(
                "invalid_grant", "refresh token does not exist or has expired"
            )
        if refresh.client_id != client.client_id:
            raise OAuthFlowError(
                "invalid_grant", "refresh token does not exist or has expired"
            )
        scopes = self._validate_scope(
            form.get("scope") or " ".join(refresh.scopes), allowed=refresh.scopes
        )
        self._refresh_tokens.pop(refresh_hash, None)
        return self._issue_token_pair(
            client_id=client.client_id, scopes=scopes, resource=refresh.resource
        )

    def _issue_token_pair(
        self, *, client_id: str, scopes: tuple[str, ...], resource: str | None
    ) -> dict:
        access_token = "ghmcp_at_" + secrets.token_urlsafe(32)
        refresh_token = "ghmcp_rt_" + secrets.token_urlsafe(32)
        now = time.time()
        self._cleanup_expired(now)
        access_hash = sha256_token(access_token)
        refresh_hash = sha256_token(refresh_token)
        self._access_tokens[access_hash] = OAuthAccessTokenRecord(
            token_hash=access_hash,
            client_id=client_id,
            scopes=scopes,
            resource=resource or self.resource_url,
            expires_at=now + self.access_token_ttl_seconds,
        )
        self._refresh_tokens[refresh_hash] = OAuthRefreshTokenRecord(
            token_hash=refresh_hash,
            client_id=client_id,
            scopes=scopes,
            resource=resource or self.resource_url,
            expires_at=now + self.refresh_token_ttl_seconds,
        )
        self._enforce_token_limits()
        self._persist_oauth_state()
        return {
            "access_token": access_token,
            "token_type": "Bearer",
            "expires_in": self.access_token_ttl_seconds,
            "scope": " ".join(scopes),
            "refresh_token": refresh_token,
        }

    def _authenticate_client(
        self, form: Mapping[str, str], headers: Mapping[str, str]
    ) -> OAuthClientRecord:
        form_client_id = form.get("client_id") or None
        supplied_secret: str | None = None
        basic_client_id: str | None = None
        auth_header = headers.get("authorization") or headers.get("Authorization") or ""
        if auth_header.startswith("Basic "):
            try:
                decoded = base64.b64decode(auth_header[6:]).decode("utf-8")
                basic_client_id, supplied_secret = decoded.split(":", 1)
            except Exception as exc:  # pragma: no cover - defensive parse guard
                raise OAuthFlowError(
                    "invalid_client",
                    "invalid Basic client authentication",
                    status_code=401,
                ) from exc

        if form_client_id and basic_client_id and form_client_id != basic_client_id:
            raise OAuthFlowError(
                "invalid_client", "client_id mismatch", status_code=401
            )
        client_id = form_client_id or basic_client_id
        if not client_id:
            raise OAuthFlowError(
                "invalid_client", "client authentication is required", status_code=401
            )
        client = self._clients.get(client_id)
        if client is None:
            raise OAuthFlowError(
                "invalid_client", "client_id is not registered", status_code=401
            )
        if client.token_endpoint_auth_method == "none":
            return client
        if client.token_endpoint_auth_method == "client_secret_post":
            supplied_secret = form.get("client_secret")
        elif client.token_endpoint_auth_method == "client_secret_basic":
            if basic_client_id is None:
                raise OAuthFlowError(
                    "invalid_client",
                    "missing Basic client authentication",
                    status_code=401,
                )
        if not client.client_secret_hash or not supplied_secret:
            raise OAuthFlowError(
                "invalid_client", "client_secret is required", status_code=401
            )
        if not hmac.compare_digest(
            sha256_token(supplied_secret).lower(), client.client_secret_hash.lower()
        ):
            raise OAuthFlowError(
                "invalid_client", "invalid client_secret", status_code=401
            )
        return client

    def _require_client(self, client_id: str | None) -> OAuthClientRecord:
        if not client_id:
            raise OAuthFlowError("invalid_request", "client_id is required")
        client = self._clients.get(client_id)
        if client is None:
            raise OAuthFlowError("invalid_request", "client_id is not registered")
        return client

    def _resolve_redirect_uri(
        self, client: OAuthClientRecord, redirect_uri: str | None
    ) -> str:
        if redirect_uri is None:
            if len(client.redirect_uris) != 1:
                raise OAuthFlowError(
                    "invalid_request",
                    "redirect_uri is required for clients with multiple redirects",
                )
            return client.redirect_uris[0]
        if redirect_uri not in client.redirect_uris:
            raise OAuthFlowError(
                "invalid_request", "redirect_uri is not registered for this client"
            )
        return redirect_uri

    def _validate_scope(
        self, scope: str, *, allowed: tuple[str, ...] | None = None
    ) -> tuple[str, ...]:
        allowed_scopes = allowed or self.scopes
        requested = tuple(part for part in scope.split() if part) or allowed_scopes
        if not set(requested).issubset(set(allowed_scopes)):
            raise OAuthFlowError("invalid_scope", "requested scope is not allowed")
        return requested

    @staticmethod
    def _validate_redirect_uri(uri: str) -> None:
        parsed = urlparse(uri)
        is_local_http = parsed.scheme == "http" and parsed.hostname in {
            "127.0.0.1",
            "localhost",
        }
        if parsed.scheme != "https" and not is_local_http:
            raise OAuthFlowError(
                "invalid_redirect_uri",
                "redirect_uris must be HTTPS except localhost HTTP",
            )
        if not parsed.netloc or parsed.fragment or parsed.username or parsed.password:
            raise OAuthFlowError("invalid_redirect_uri", "redirect_uri is not allowed")

    @staticmethod
    def _string_tuple(value: object) -> tuple[str, ...]:
        if value is None:
            return ()
        if isinstance(value, str):
            return tuple(part for part in value.split() if part)
        if isinstance(value, Iterable):
            return tuple(str(part) for part in value if str(part))
        return ()

    @staticmethod
    def parse_form_body(body: bytes) -> dict[str, str]:
        try:
            decoded = body.decode("utf-8", errors="strict")
        except UnicodeDecodeError as exc:
            raise OAuthFlowError(
                "invalid_request", "form body must be valid UTF-8"
            ) from exc
        parsed = parse_qs(decoded, keep_blank_values=True)
        return {key: values[-1] if values else "" for key, values in parsed.items()}

    @staticmethod
    def _pkce_s256(verifier: str) -> str:
        digest = hashlib.sha256(verifier.encode("utf-8")).digest()
        return base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")

    @staticmethod
    def _append_query(url: str, query: Mapping[str, str]) -> str:
        parsed = urlparse(url)
        existing = parse_qs(parsed.query, keep_blank_values=True)
        for key, value in query.items():
            existing[key] = [value]
        query_string = urlencode(existing, doseq=True)
        return urlunparse(
            (
                parsed.scheme,
                parsed.netloc,
                parsed.path,
                parsed.params,
                query_string,
                parsed.fragment,
            )
        )

    def _cleanup_expired(
        self, now: float | None = None, *, force: bool = False
    ) -> None:
        now = time.time() if now is None else now
        if not force and now - self._last_cleanup_at < self.cleanup_interval_seconds:
            return
        self._last_cleanup_at = now
        before = (
            len(self._pending_authorizations),
            len(self._authorization_codes),
            len(self._access_tokens),
            len(self._refresh_tokens),
        )
        self._pending_authorizations = {
            key: value
            for key, value in self._pending_authorizations.items()
            if value.expires_at >= now
        }
        self._authorization_codes = {
            key: value
            for key, value in self._authorization_codes.items()
            if value.expires_at >= now
        }
        self._access_tokens = {
            key: value
            for key, value in self._access_tokens.items()
            if value.expires_at >= now
        }
        self._refresh_tokens = {
            key: value
            for key, value in self._refresh_tokens.items()
            if value.expires_at >= now
        }
        after = (
            len(self._pending_authorizations),
            len(self._authorization_codes),
            len(self._access_tokens),
            len(self._refresh_tokens),
        )
        if before != after:
            self._persist_oauth_state()

    def _enforce_token_limits(self) -> None:
        for store, limit in (
            (self._access_tokens, self.max_access_tokens),
            (self._refresh_tokens, self.max_refresh_tokens),
        ):
            if len(store) <= limit:
                continue
            removable = sorted(store.items(), key=lambda item: item[1].expires_at)
            for key, _record in removable[: len(store) - limit]:
                store.pop(key, None)

    def _reserve_client_slot(self) -> None:
        if len(self._clients) < self.max_clients:
            return
        removable = sorted(
            (
                client
                for client in self._clients.values()
                if client.authorized_at is None
            ),
            key=lambda client: client.issued_at,
        )
        needed = len(self._clients) - self.max_clients + 1
        if len(removable) < needed:
            raise OAuthFlowError(
                "temporarily_unavailable",
                "OAuth client registration capacity is reserved for already-authorized clients",
                status_code=503,
            )
        for client in removable[:needed]:
            self._clients.pop(client.client_id, None)

    def _enforce_pending_limit(self) -> None:
        if len(self._pending_authorizations) <= self.max_pending_authorizations:
            return
        removable = sorted(
            self._pending_authorizations.values(), key=lambda record: record.expires_at
        )
        for record in removable[
            : len(self._pending_authorizations) - self.max_pending_authorizations
        ]:
            self._pending_authorizations.pop(record.request_id, None)

    @staticmethod
    def redacted_client_label(client_id: str) -> str:
        return client_id[:14] + "…"

    @staticmethod
    def quote_html(value: str | None) -> str:
        if value is None:
            return ""
        return (
            value.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace('"', "&quot;")
            .replace("'", "&#x27;")
        )

    @staticmethod
    def quote_attr(value: str | None) -> str:
        return quote(GatewayOAuthManager.quote_html(value), safe="")
