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

- **Container Configuration**: Allows setting and retrieving container-level settings, such as filter prompts, to customize ingestion pipelines. This is managed via dedicated API endpoints.
- **Text generation**: `LLM_PROVIDER=anthropic` keeps the existing API-key path. `LLM_PROVIDER=openai-codex` uses a private authenticated relay and `gpt-5.6-luna`; OAuth credentials remain outside the Supermemento container.
- **Embeddings**: Continue to use the OpenAI embedding configuration independently of the text-generation provider.

See [OpenAI Codex OAuth deployment](docs/OPENAI_CODEX_OAUTH.md) for the relay trust boundary, installation and rollback procedure.

## Key Advantages over SaaS alternatives

- 🔒 **Data sovereignty** — Self-hosted, your data stays yours
- 🔍 **Graph transparency** — Full visibility into the knowledge graph
- ✅ **Validation Protocol v3.0** — 8 quality filters (vs. black-box approaches)
- 💰 **~$20/month** estimated operational cost

## Getting Started

See [docs/SPEC.md](docs/SPEC.md) for the complete development specification.

## License

Private — All rights reserved.
