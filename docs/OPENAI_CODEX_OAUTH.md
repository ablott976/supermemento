# OpenAI Codex OAuth for Supermemento

## Architecture

Supermemento never receives an OpenAI OAuth access or refresh token. It sends a constrained OpenAI Responses request through an internal sidecar and reverse SSH tunnel to an authenticated relay on the Hermes host. The relay:

1. validates a dedicated internal bearer;
2. allowlists one model and `/v1/responses` only;
3. requires `stream=true` and `store=false`;
4. accepts one user text message and no tools, continuations or background jobs;
5. resolves and refreshes OAuth from the selected Hermes profile;
6. streams the upstream response without logging prompts or response bodies.

The application supports `anthropic` and `openai-codex` as explicit providers. There is no automatic cross-provider fallback, avoiding duplicate calls and unexpected billing.

The relay listens on loopback only. A persistent reverse SSH tunnel terminates in a Unix socket on the VPS. A minimal sidecar on the same Docker overlay as Supermemento bridges that socket to an internal service name. No host TCP port is opened on either machine.

## Runtime files

- Relay: `deploy/codex_oauth_relay.py`
- TCP bridge: `deploy/private_tcp_forwarder.py`
- Sidecar image: `deploy/Dockerfile.codex-bridge`
- Sidecar deploy: `deploy/deploy_codex_bridge.sh`
- Application secret/provider wiring: `deploy/configure_codex_app.sh`
- Hermes user services: `deploy/supermemento-codex-relay.service`, `deploy/supermemento-codex-tunnel.service`
- Installed relay: `~/.local/lib/supermemento/codex_oauth_relay.py`
- Service units: `~/.config/systemd/user/`
- Secret environment: `~/.config/supermemento/codex-relay.env` (`0600`)

The environment file contains the allowlisted model and a randomly generated relay bearer. It must not contain or copy OAuth tokens.

## Required environment

Relay host:

```text
SUPERMEMENTO_CODEX_MODEL=gpt-5.6-luna
SUPERMEMENTO_CODEX_RELAY_KEY=<generated-secret>
```

Supermemento:

```text
LLM_PROVIDER=openai-codex
OPENAI_CODEX_MODEL=gpt-5.6-luna
OPENAI_CODEX_BASE_URL=http://codex-oauth-bridge:18646/v1
OPENAI_CODEX_RELAY_KEY_FILE=/run/secrets/supermemento_codex_relay_key
LLM_REQUEST_TIMEOUT_MS=120000
LLM_REASONING_EFFORT=low
```

The relay URL must target loopback, the exact internal sidecar alias, RFC1918 or `100.64.0.0/10`. Public hosts are rejected even over HTTPS so the internal bearer cannot be redirected outside the trust boundary.

## Installation

1. Authenticate the dedicated Hermes profile with OpenAI Codex OAuth.
2. Copy the relay and Hermes service units to the runtime paths above.
3. Generate the relay bearer directly into the Hermes `0600` environment file; never print it or add it to shell history.
4. On the Hermes host, enable the relay and reverse-tunnel services.
5. Build and deploy the immutable bridge sidecar on the `easypanel-n8n` overlay without a published port.
6. Verify local `/health`, unauthenticated `401`, and an authenticated synthetic JSON request.
7. Verify the internal route from the Supermemento container.
8. Deploy the immutable Supermemento image, retain the previous image, then pipe the bearer to `deploy/configure_codex_app.sh`. The script creates/attaches `supermemento_codex_relay_key`, sets `OPENAI_CODEX_RELAY_KEY_FILE`, removes a direct bearer environment variable if present, waits for the new task and verifies health.
9. Reprocess one failed document and verify its terminal state before resuming bulk ingestion.

## Failure and rollback

- Missing/expired OAuth or an unreachable relay produces a provider error. Ingestion remains fail-closed and the historical coordinator pauses.
- The relay retries once only after an upstream `401`, forcing OAuth refresh before the retry.
- Rollback consists of setting `LLM_PROVIDER=anthropic`, restoring the prior image/config and stopping the relay if no other client uses it.
- Do not automatically switch providers inside a single ingestion attempt; a provider change is an explicit operational action.

## Security checks

- OAuth tokens absent from repo, container environment and application logs.
- Relay bearer stored with mode `0600` on Hermes and mounted as a Docker Swarm secret in Supermemento; rotate it if exposed.
- Relay bound to loopback only; SSH uses a VPS Unix socket and the bridge is reachable only on the Docker overlay.
- No prompt, email body, model output or upstream response body in relay logs.
- `store=false`, no tools, no previous response, no background execution.
- Body size capped and model allowlisted.
