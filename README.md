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

See [docs/SPEC.md](docs/SPEC.md) for the complete development specification.

## License

Private — All rights reserved.
