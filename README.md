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


## Key Advantages over SaaS alternatives

- 🔒 **Data sovereignty** — Self-hosted, your data stays yours
- 🔍 **Graph transparency** — Full visibility into the knowledge graph
- ✅ **Validation Protocol v3.0** — 8 quality filters (vs. black-box approaches)
- 💰 **~$20/month** estimated operational cost

## Getting Started

### 1. Install dependencies

From the project root (`supermemento-e9`), install Node.js dependencies:

```bash
npm install
```

If you want a clean, lockfile-strict install in CI-style environments, use:

```bash
npm ci
```

### 2. Configure environment variables

Create your local environment file from the example:

```bash
cp .env.example .env
```

Then update `.env` with values for your setup:

```env
# Use localhost when running the server from your host machine with `npm run dev`
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=supermemento

# Add your provider keys
OPENAI_API_KEY=your_openai_key
ANTHROPIC_API_KEY=your_anthropic_key

# Optional overrides
ANTHROPIC_MODEL=claude-haiku-4-5-20251001
OPENAI_EMBEDDING_MODEL=text-embedding-3-large
```

Variable reference:
- `NEO4J_URI` Neo4j Bolt endpoint (`bolt://localhost:7687` for local dev, `bolt://neo4j:7687` inside Docker network)
- `NEO4J_USER` Neo4j username
- `NEO4J_PASSWORD` Neo4j password (must match Docker Compose `NEO4J_AUTH`)
- `OPENAI_API_KEY` required for embeddings and OpenAI-powered flows
- `ANTHROPIC_API_KEY` required for relation classification/extraction flows
- `ANTHROPIC_MODEL` optional model override (default: `claude-haiku-4-5-20251001`)
- `OPENAI_EMBEDDING_MODEL` optional embedding model override (default: `text-embedding-3-large`)

### 3. Start Neo4j

Run Neo4j locally with Docker Compose:

```bash
docker compose up -d neo4j
```

### 4. Initialize Neo4j schema

After Neo4j is running and `.env` is configured, initialize the graph schema:

```bash
npm run setup:schema
```

What this does:
- Creates required uniqueness constraints for core nodes.
- Creates lookup indexes used by ingestion and retrieval flows.
- Creates vector indexes (`memory_embeddings`, `chunk_embeddings`) for semantic search.

Notes:
- The setup is idempotent (`IF NOT EXISTS`), so it is safe to run multiple times.
- Re-run this command after pulling schema-related changes.

### 5. Run the server in development mode

```bash
npm run dev
```

For full architecture and implementation details, see [docs/SPEC.md](docs/SPEC.md).

## License

Private — All rights reserved.
