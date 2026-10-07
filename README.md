# Supermemento — Memento v2.0

**Intelligent Memory Infrastructure for AI Agents**

An evolution of the Memento knowledge graph system (Neo4j/MCP) into a dynamic intelligent memory platform. Self-hosted, transparent, and sovereign.

## Architecture

- **Neo4j** — Graph database with vector indexes for semantic search
- **MCP Server** — Model Context Protocol server for AI agent integration
- **n8n Workflows** — Orchestration for ingestion, relation classification, and maintenance
- **text-embedding-3-large** — 3072-dimension embeddings for high-quality semantic search

## Core Concepts

| Concept | Description |
|---------|-------------|
| **Document** | Raw content ingested (PDF, URL, text, audio, etc.) |
| **Memory** | Atomic fact extracted from a Document with embeddings and temporal metadata |
| **Relations** | Intelligent links between memories: UPDATES, EXTENDS, DERIVES |

## Phases

1. **Intelligent Relations** — Auto-detect updates, extensions, and derivations between memories (CRITICAL)
2. **Automatic Forgetting** — Time-based decay, episode expiry, preference reinforcement (CRITICAL)
3. **Multimodal Ingestion** — PDF, URL, image, video, audio, conversation pipelines (HIGH)
4. **SuperRAG** — Hybrid search, reranking, query rewriting, contextual chunking (HIGH)
5. **User Profiles** — Auto-generated static + dynamic user profiles (MEDIUM)
6. **Connectors** — Web crawler, Google Drive, WhatsApp/Chat sync (MEDIUM)

## Configuration

### Memory metadata

`create_memory` accepts an optional `metadata` JSON object. `batch_create_memories`
accepts it on each memory item. Nested objects, arrays, and JSON scalar values
are stored as JSON on the Neo4j Memory node and returned as an object when read,
listed, or searched. Existing memories without metadata return `{}`.

`update_memory` replaces the metadata object when supplied. Omit `metadata` to
preserve it, or pass `{}` to clear it. Document metadata remains independent.

After deployment, refresh the connector's MCP tool definitions so clients can
discover the new optional parameter.

### Memory policy: temporal_class, validTo and deduplication

`temporal_class` (`pricing` | `roadmap` | `pipeline` | `none`, default `none`) is
declared by whoever creates a memory, on `create_memory`, each item of
`batch_create_memories` and the ingestion/crawl tools. Any class other than
`none` requires `validTo`; the server rejects the call otherwise. Exact
duplicates (same `containerTag` and normalised content as an active memory)
are never created: the response is `{ created: false, duplicateOf }`. Semantic
near-duplicates are only reported as `possibleDuplicates`. `semantic_search`
returns `confidence`, `validFrom`, `validTo`, `isLatest` and `forgottenAt` on
every memory result. A date-only `validFrom`/`validTo` is a Europe/Madrid
business day (`BUSINESS_TIMEZONE`): `validFrom` starts at 00:00 local and
`validTo` lasts until 23:59:59.999 local, never midnight UTC. Contract, ingestion rules and the reversible cleanup of
historical duplicates: [docs/MEMORY_POLICY.md](docs/MEMORY_POLICY.md).

- **Container Configuration**: Allows setting and retrieving container-level settings, such as filter prompts, to customize ingestion pipelines. This is managed via dedicated API endpoints.
- **Text generation**: `LLM_PROVIDER=openai-codex-subscription` uses the official Codex SDK and a dedicated persistent `CODEX_HOME` authenticated with ChatGPT. `anthropic` and the legacy Hermes-backed `openai-codex` relay remain available for explicit rollback.
- **Embeddings**: Continue to use the OpenAI embedding configuration independently of the text-generation provider.

See [Codex subscription deployment](docs/OPENAI_CODEX_SUBSCRIPTION.md) for authentication, validation and rollback. The former [relay deployment](docs/OPENAI_CODEX_OAUTH.md) remains documented only as a temporary rollback route.

## Key Advantages over SaaS alternatives

- 🔒 **Data sovereignty** — Self-hosted, your data stays yours
- 🔍 **Graph transparency** — Full visibility into the knowledge graph
- ✅ **Validation Protocol v3.0** — 8 quality filters (vs. black-box approaches)
- 💰 **~$20/month** estimated operational cost

## Getting Started

These steps run the TypeScript MCP server locally with a dedicated development
Neo4j database. Use Node.js 22.13+ (the Docker image uses Node 22), npm, and Docker
with Docker Compose. The default text provider also requires an Anthropic API key;
embeddings require an OpenAI API key regardless of the text provider.

### 1. Install dependencies

From the repository root:

```sh
npm ci
cp .env.example .env
```

`npm ci` installs the versions in `package-lock.json`. Use `npm install` when
intentionally updating dependencies.

### 2. Configure the environment

Edit `.env` before starting anything:

| Variable | Local development value |
|----------|-------------------------|
| `NEO4J_URI` | `bolt://localhost:7687` (the example's `neo4j` hostname is for Docker networking) |
| `NEO4J_USER` | `neo4j` |
| `NEO4J_PASSWORD` | Choose a local password; Compose uses the same value to initialize Neo4j |
| `OPENAI_API_KEY` | Your OpenAI API key for embeddings |
| `OPENAI_EMBEDDING_MODEL` | Keep `text-embedding-3-large`; the schema uses 3072-dimensional vector indexes |
| `LLM_PROVIDER` | Keep `anthropic` for this walkthrough |
| `ANTHROPIC_API_KEY` | Your Anthropic API key for text generation |

Add `MCP_HOST=127.0.0.1` to bind the local server to loopback. `PORT=8080` is
already in the example; `MCP_PORT` overrides it if set. Gateway settings are for
the separate ChatGPT service and are not needed here. For other text providers,
see the [Codex subscription guide](docs/OPENAI_CODEX_SUBSCRIPTION.md) or the
[legacy relay guide](docs/OPENAI_CODEX_OAUTH.md).

The npm scripts read the process environment; they do **not** load `.env`
automatically. In a POSIX-compatible shell (bash or zsh), export the edited file:

```sh
set -a
. ./.env
set +a
```

Repeat this in each new terminal used for schema setup or the server, and after
editing `.env`. Quote values containing shell-special characters. `.env` is
ignored by Git; keep API keys and passwords out of commits and logs.

### 3. Start Neo4j and initialize the schema

```sh
docker compose up -d neo4j
docker compose logs -f neo4j
```

Wait for Neo4j's `Started.` message, then stop following logs with Ctrl+C (the
database stays running). Neo4j Browser is at `http://localhost:7474`; Bolt is on
port 7687. Compose keeps database data in a named volume, so changing the password
in `.env` does not reset an already initialized database's password.

With the environment exported in the same terminal, run:

```sh
npm run setup:schema
```

This creates the constraints, regular indexes, and `memory_embeddings` /
`chunk_embeddings` vector indexes. It is safe to rerun: existing schema objects
are retained. Use only your local development database for this walkthrough.

### 4. Run the development server

```sh
npm run dev
```

This runs `src/index.ts` through `tsx`; restart it after code changes. The default
HTTP transport exposes Streamable HTTP at `http://127.0.0.1:8080/mcp` and SSE at
`http://127.0.0.1:8080/sse`. In another terminal, check startup with:

```sh
curl --fail http://127.0.0.1:8080/health
```

Expect a JSON response with `status: "ok"`. This checks HTTP startup; it does not
exercise ingestion or the external AI providers. Set `MCP_TRANSPORT=stdio` when
launching from a client that uses stdio instead of HTTP. Stop the server with
Ctrl+C, and stop the local database with `docker compose stop neo4j`.

See [docs/SPEC.md](docs/SPEC.md) for the development specification and historical
architecture plan. n8n is not required for this local server setup.

## License

Private — All rights reserved.
