"""End-to-end multi-client OAuth tests with no production state."""

import base64
import hashlib
import html
import re
from urllib.parse import parse_qs, urlparse

import pytest
from starlette.testclient import TestClient

from tests import test_chatgpt_gateway as base
from chatgpt_gateway.config import client_redirect_uri_allowed
from chatgpt_gateway.oauth_redirects import registered_redirect_matches
from chatgpt_gateway.server import (
    build_auth_provider,
    build_host_origin_options,
    build_oauth_manager,
    create_gateway,
)

CHATGPT = "https://chatgpt.com/connector_platform_oauth_redirect"
CLAUDE = "https://claude.ai/api/mcp/auth_callback"


@pytest.mark.parametrize(
    "uri",
    [
        CLAUDE + "/evil",
        CLAUDE + "?next=evil",
        CLAUDE + "#x",
        "https://claude.ai.evil/api/mcp/auth_callback",
        "https://evil@claude.ai/api/mcp/auth_callback",
        "http://127.0.0.1.evil:1234/callback",
        "http://127.0.0.2:1234/callback",
        "http://localhost:1234/evil",
        "http://localhost:0/callback",
        "http://127.0.0.1:65536/callback",
        "http://127.0.0.1:1234/callback/../evil",
        "http://127.0.0.1:1234/callback?next=evil",
        "http://user@localhost/callback",
        "http://localhost:1234/callback#evil",
        "http://localhost:1234/callback/%2f",
        "https://[claude.ai/api/mcp/auth_callback",
        " " + CLAUDE,
    ],
)
def test_callback_rejects_unsafe_variants(uri):
    assert not client_redirect_uri_allowed(uri, (CHATGPT,))


def test_loopback_matches_only_port():
    assert registered_redirect_matches(
        "http://127.0.0.1:49152/callback/id", "http://127.0.0.1/callback/id"
    )
    for uri in [
        "http://localhost:49152/callback/id",
        "http://127.0.0.1:49152/callback/other",
        "http://127.0.0.1:49152/callback/id?x=1",
    ]:
        assert not registered_redirect_matches(uri, "http://127.0.0.1/callback/id")
    assert not registered_redirect_matches(
        CLAUDE.replace("claude.ai", "claude.ai:443"), CLAUDE
    )


@pytest.mark.parametrize(
    "registered,redirect,origin",
    [
        (CHATGPT, CHATGPT, "https://chatgpt.com"),
        (
            "https://chatgpt.com/connector/oauth/test-123",
            "https://chatgpt.com/connector/oauth/test-123",
            "https://chatgpt.com",
        ),
        (CLAUDE, CLAUDE, "https://claude.ai"),
        (
            "http://127.0.0.1/callback/codex-123",
            "http://127.0.0.1:49152/callback/codex-123",
            None,
        ),
        ("http://localhost/callback", "http://localhost:3118/callback", None),
    ],
)
def test_oauth_client_flow(tmp_path, registered, redirect, origin):
    cfg = base.settings(tmp_path)
    manager = build_oauth_manager(cfg)
    gateway = create_gateway(
        cfg,
        target=base._backend(),
        oauth_manager=manager,
        auth_provider=build_auth_provider(cfg, manager),
    )
    app = gateway.http_app(
        path="/mcp",
        transport="http",
        stateless_http=True,
        json_response=True,
        **build_host_origin_options(cfg),
    )
    headers = {"Origin": origin} if origin else {}
    with TestClient(app, base_url=cfg.public_base_url) as client:
        registration = {
            "client_name": "Compatibility test",
            "redirect_uris": [registered],
            "token_endpoint_auth_method": "none",
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"],
        }
        for bad_origin in ["https://evil.example", "null", "https://claude.ai.evil"]:
            assert (
                client.post(
                    "/register", json=registration, headers={"Origin": bad_origin}
                ).status_code
                == 403
            )
        result = client.post("/register", json=registration, headers=headers)
        assert result.status_code == 201, result.text
        client_id = result.json()["client_id"]
        verifier = "v" * 64
        challenge = (
            base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest())
            .rstrip(b"=")
            .decode()
        )
        params = {
            "response_type": "code",
            "client_id": client_id,
            "redirect_uri": redirect,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "state": "test-state",
        }
        assert (
            client.get(
                "/authorize", params={**params, "redirect_uri": redirect + "/wrong"}
            ).status_code
            == 400
        )
        page = client.get("/authorize", params=params)
        assert page.status_code == 200, page.text
        assert html.escape(redirect) in page.text
        hidden = {
            k: html.unescape(v)
            for k, v in re.findall(r'name="([^"]+)" value="([^"]*)"', page.text)
        }
        consent = client.post(
            "/authorize",
            data={
                "request_id": hidden["request_id"],
                "csrf_token": hidden["csrf_token"],
                "setup_token": base.OWNER_TOKEN,
            },
            headers={"Origin": cfg.public_base_url},
            follow_redirects=False,
        )
        assert consent.status_code == 302, consent.text
        location = consent.headers["location"]
        assert location.startswith(redirect + "?")
        query = parse_qs(urlparse(location).query)
        assert query["state"] == ["test-state"]
        form = {
            "grant_type": "authorization_code",
            "client_id": client_id,
            "redirect_uri": redirect,
            "code": query["code"][0],
            "code_verifier": verifier,
        }
        assert (
            client.post("/token", data={**form, "code_verifier": "wrong"}).status_code
            == 400
        )
        assert (
            client.post(
                "/token", data={**form, "redirect_uri": redirect + "/wrong"}
            ).status_code
            == 400
        )
        token = client.post("/token", data=form)
        assert token.status_code == 200, token.text
        auth = {
            **headers,
            "Authorization": "Bearer " + token.json()["access_token"],
            "Accept": "application/json, text/event-stream",
        }
        tools = client.post(
            "/mcp",
            headers=auth,
            json={"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}},
        )
        assert tools.status_code == 200, tools.text
        assert tools.json()["result"]["tools"]
        assert client.post("/token", data=form).status_code == 400
    reloaded = build_oauth_manager(cfg)
    refreshed = reloaded.exchange_token(
        {
            "grant_type": "refresh_token",
            "client_id": client_id,
            "refresh_token": token.json()["refresh_token"],
        },
        {},
    )
    assert refreshed["access_token"]
