# CLAUDE.md — Supermemento

## Project
Drop-in replacement for Memento MCP server. Intelligent memory platform with smart relations, auto-forgetting, multimodal ingestion, and SuperRAG.
Full spec in `docs/BLUEPRINT.md`.

## Tech Stack
- Python 3.12, FastAPI 0.115+, Neo4j 5.x (Bolt via `neo4j-driver`)
- OpenAI text-embedding-3-large (3072d), Claude Sonnet (LLM tasks)
- APScheduler (background jobs), SSE transport (MCP protocol)
- Pydantic v2 for validation, httpx for HTTP client

## Architecture (MANDATORY)
Layered architecture — layers only call downward:
```
MCP Transport (app/mcp/)  + API (app/main.py)  →  routes + dispatch
Tools (app/tools/)                              →  orchestration only
Services (app/services/)                        →  ALL business logic
Models (app/models/) + DB (app/db/)             →  Neo4j + Pydantic
```
- Tools are stateless — receive driver as dependency
- Queries in `db/queries.py` — NEVER inline Cypher
- Services encapsulate business logic — tools only orchestrate

## Commands
```bash
uvicorn app.main:app --reload        # Dev server
pytest tests/ -x -q                  # Run tests
ruff check . --fix                   # Lint + autofix
docker compose up -d                 # Full stack (Neo4j + app)
```

## Conventions
- Async everywhere (async def, await)
- Pydantic schemas in app/models/, Neo4j operations in app/db/
- Test file per module: test_health.py, test_entities.py, etc.
- All MCP tools registered in app/mcp/tools.py registry
- ISO 8601 timestamps in UTC

## Rules
- NEVER use --force when pushing to git
- NEVER modify docs/BLUEPRINT.md
- NEVER modify tests to make them pass by skipping — fix the actual code
- NEVER invent data or hardcode test values in production code
- All new tools MUST have tests
- Follow existing patterns — look at how existing files are structured before creating new ones
- README must only document what is actually implemented
