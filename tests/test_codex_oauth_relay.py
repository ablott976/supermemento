from __future__ import annotations

import base64
import importlib.util
import json
from pathlib import Path

import pytest

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


def test_authorization_requires_exact_bearer() -> None:
    assert relay.is_authorized("Bearer internal-secret", "internal-secret")
    assert not relay.is_authorized("Bearer wrong", "internal-secret")
    assert not relay.is_authorized("", "internal-secret")


def test_validate_payload_enforces_codex_contract() -> None:
    valid = {
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
