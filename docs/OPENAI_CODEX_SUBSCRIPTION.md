# OpenAI Codex subscription runtime for Supermemento

## Architecture

`LLM_PROVIDER=openai-codex-subscription` implements `TextGenerationClient.complete()` with the official `@openai/codex-sdk`. The SDK starts its pinned local Codex CLI runtime for each request. That runtime authenticates directly with OpenAI using a ChatGPT sign-in cached under a dedicated `CODEX_HOME`.

This path does not call the Hermes relay, does not use `OPENAI_CODEX_BASE_URL`, and does not use `OPENAI_CODEX_RELAY_KEY`. The child Codex process receives an allowlisted environment that deliberately excludes `OPENAI_API_KEY`, so the embedding API key cannot become the text-generation credential.

Each completion uses a fresh, non-resumable thread with:

- read-only sandbox;
- approvals disabled;
- tool network access and web search disabled;
- an isolated working directory;
- a request timeout enforced with `AbortSignal`.

Embeddings remain unchanged. `EmbeddingService` continues to use `OPENAI_API_KEY` and `OPENAI_EMBEDDING_MODEL` independently.

## Configuration

```text
LLM_PROVIDER=openai-codex-subscription
OPENAI_CODEX_MODEL=gpt-5.6-luna
CODEX_HOME=/data/supermemento-codex
OPENAI_CODEX_WORKDIR=/app
LLM_REQUEST_TIMEOUT_MS=180000
LLM_REASONING_EFFORT=low
```

`CODEX_HOME` and `OPENAI_CODEX_WORKDIR` must be absolute. Mount `/data/supermemento-codex` from persistent storage. Do not point it at a developer's normal `~/.codex`; it is a service-specific credential and session store.

## Authenticate with ChatGPT

The official Codex runtime supports browser login and device-code login. In a headless deployment, open a shell in the Supermemento container and run:

```sh
CODEX_HOME=/data/supermemento-codex ./node_modules/.bin/codex login --device-auth
CODEX_HOME=/data/supermemento-codex ./node_modules/.bin/codex login status
```

Complete the one-time browser step with the intended ChatGPT account. The resulting `auth.json` contains access and refresh tokens. Keep the volume private, never commit it, and never copy its contents into logs or tickets.

## Query-rewrite availability

Query rewriting is an optional search enhancement. When the LLM reports HTTP 401, 403, 408, 429, 5xx, a recognized auth failure, or a timeout, `QueryRewriterService` logs a content-free fallback event and returns the original query. Semantic search then generates the embedding from that original query and continues normally. Deterministic rewrite bugs remain visible instead of being hidden.

## Validation

1. Confirm `codex login status` reports ChatGPT authentication in the dedicated home.
2. Set `LLM_PROVIDER=openai-codex-subscription` and restart only the Supermemento service.
3. Run a simple `TextGenerationClient.complete()` smoke request.
4. Call `semantic_search` with `rewriteQuery=true` and confirm a non-empty result envelope.
5. Inject or simulate a 429 in query rewrite and confirm the response uses the original query.
6. Run an embedding smoke test and confirm the configured embedding model and vector dimensions are unchanged.
7. Inspect runtime/service logs and network configuration to confirm there are no requests to `codex-oauth-bridge`, port `8646`, or the Hermes host.

## Rollback

Rollback is an explicit provider switch. No automatic cross-provider fallback is used for ingestion.

- Preferred temporary rollback: restore `LLM_PROVIDER=openai-codex` while keeping the former relay URL, key secret, sidecar and tunnel available.
- Alternative rollback: set `LLM_PROVIDER=anthropic` with its existing key and model.
- Restore the previous immutable application image if the runtime package itself is the failure source.

The dedicated Codex volume can stay mounted during rollback. Do not delete it, because that would remove the refreshable ChatGPT session.
