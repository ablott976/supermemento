from __future__ import annotations

import asyncio
import base64
import importlib.util
import json
from pathlib import Path

import pytest
from aiohttp.test_utils import TestClient, TestServer

MODULE_PATH = Path(__file__).resolve().parents[1] / "deploy" / "codex_oauth_relay.py"
spec = importlib.util.spec_from_file_location("codex_oauth_relay", MODULE_PATH)
assert spec and spec.loader
relay = importlib.util.module_from_spec(spec)
spec.loader.exec_module(relay)


def _jwt(account_id: str) -> str:
    payload = base64.urlsafe_b64encode(
        json.dumps({"https://api.openai.com/auth": {"chatgpt_account_id": account_id}}).encode()
    ).decode().rstrip("=")
    return f"header.{payload}.signature"


def _payload() -> dict:
    return {
        "model": "gpt-5.6-luna",
        "instructions": "Return JSON",
        "stream": True,
        "store": False,
        "input": [
            {
                "role": "user",
                "content": [{"type": "input_text", "text": "payload"}],
            }
        ],
        "reasoning": {"effort": "low", "summary": "auto"},
    }


def test_authorization_requires_exact_bearer() -> None:
    assert relay.is_authorized("Bearer internal-secret", "internal-secret")
    assert not relay.is_authorized("Bearer wrong", "internal-secret")
    assert not relay.is_authorized("", "internal-secret")


def test_validate_payload_enforces_codex_contract() -> None:
    valid = _payload()
    assert relay.validate_payload(valid, "gpt-5.6-luna") == valid

    for invalid in (
        {**valid, "model": "other"},
        {**valid, "stream": False},
        {**valid, "store": True},
        {**valid, "tools": []},
        {**valid, "previous_response_id": "response-id"},
        {**valid, "metadata": {"unsafe": True}},
        {**valid, "input": []},
    ):
        with pytest.raises(ValueError):
            relay.validate_payload(invalid, "gpt-5.6-luna")


def test_codex_headers_include_account_without_exposing_token() -> None:
    token = _jwt("account-123")
    headers = relay.codex_headers(token)
    assert headers["Authorization"] == f"Bearer {token}"
    assert headers["ChatGPT-Account-ID"] == "account-123"
    assert headers["originator"] == "codex_cli_rs"


def test_sanitize_upstream_error_drops_body() -> None:
    result = relay.sanitize_upstream_error(401, "sensitive upstream body")
    assert result == {"error": {"type": "upstream_error", "message": "Codex upstream failed (HTTP 401)"}}
    assert "sensitive" not in json.dumps(result)


def test_upstream_url_is_strictly_allowlisted() -> None:
    assert relay.validate_upstream_base_url(
        "https://chatgpt.com/backend-api/codex/"
    ) == "https://chatgpt.com/backend-api/codex"
    for value in (
        "http://chatgpt.com/backend-api/codex",
        "https://chatgpt.com.evil.example/backend-api/codex",
        "https://chatgpt.com:444/backend-api/codex",
        "https://user@chatgpt.com/backend-api/codex",
        "https://chatgpt.com/backend-api/codex?target=evil",
        "https://chatgpt.com/other",
    ):
        with pytest.raises(ValueError):
            relay.validate_upstream_base_url(value)


class _FakeContent:
    def __init__(self, chunks: list[bytes]) -> None:
        self.chunks = chunks

    async def iter_any(self):
        for chunk in self.chunks:
            yield chunk


class _FakeResponse:
    def __init__(self, status: int, *, body: bytes = b"", chunks: list[bytes] | None = None) -> None:
        self.status = status
        self.body = body
        self.headers = {"Content-Type": "text/event-stream"}
        self.content = _FakeContent(chunks or [])

    async def read(self) -> bytes:
        return self.body

    def release(self) -> None:
        return None


def _session_factory(responses: list[_FakeResponse], calls: list[dict]):
    class FakeSession:
        def __init__(self, **_kwargs) -> None:
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args) -> None:
            return None

        async def post(self, url: str, **kwargs):
            calls.append({"url": url, "headers": kwargs["headers"]})
            return responses.pop(0)

    return FakeSession


def test_http_retries_one_401_with_forced_refresh_and_streams_sse(monkeypatch) -> None:
    async def scenario() -> None:
        refresh_calls: list[bool] = []
        upstream_calls: list[dict] = []
        responses = [
            _FakeResponse(401, body=b"sensitive first body"),
            _FakeResponse(200, chunks=[b'data: {"type":"response.completed"}\n\n']),
        ]

        def credentials(*, force_refresh: bool = False):
            refresh_calls.append(force_refresh)
            return {
                "api_key": "refreshed-token" if force_refresh else "initial-token",
                "base_url": "https://chatgpt.com/backend-api/codex",
            }

        monkeypatch.setattr(relay, "resolve_credentials", credentials)
        monkeypatch.setattr(relay, "ClientSession", _session_factory(responses, upstream_calls))
        client = TestClient(TestServer(relay.create_app("r" * 48, "gpt-5.6-luna")))
        await client.start_server()
        try:
            response = await client.post(
                "/v1/responses",
                json=_payload(),
                headers={"Authorization": f"Bearer {'r' * 48}"},
            )
            body = await response.text()
        finally:
            await client.close()

        assert response.status == 200
        assert body == 'data: {"type":"response.completed"}\n\n'
        assert refresh_calls == [False, True]
        assert upstream_calls[0]["headers"]["Authorization"] == "Bearer initial-token"
        assert upstream_calls[1]["headers"]["Authorization"] == "Bearer refreshed-token"
        assert all(call["url"] == "https://chatgpt.com/backend-api/codex/responses" for call in upstream_calls)

    asyncio.run(scenario())


def test_http_second_401_is_sanitized(monkeypatch) -> None:
    async def scenario() -> None:
        upstream_calls: list[dict] = []
        responses = [
            _FakeResponse(401, body=b"first sensitive body"),
            _FakeResponse(401, body=b"second sensitive body"),
        ]
        monkeypatch.setattr(
            relay,
            "resolve_credentials",
            lambda **_kwargs: {
                "api_key": "oauth-token-must-not-leak",
                "base_url": "https://chatgpt.com/backend-api/codex",
            },
        )
        monkeypatch.setattr(relay, "ClientSession", _session_factory(responses, upstream_calls))
        client = TestClient(TestServer(relay.create_app("r" * 48, "gpt-5.6-luna")))
        await client.start_server()
        try:
            response = await client.post(
                "/v1/responses",
                json=_payload(),
                headers={"Authorization": f"Bearer {'r' * 48}"},
            )
            body = await response.text()
        finally:
            await client.close()

        assert response.status == 401
        assert "Codex upstream failed (HTTP 401)" in body
        assert "sensitive" not in body
        assert "oauth-token" not in body

    asyncio.run(scenario())
