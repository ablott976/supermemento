# Supermemento

Intelligent memory platform with smart relations, auto-forgetting, multimodal ingestion, and SuperRAG. Drop-in replacement for Memento MCP server.

## Features (Currently Implemented)
- **FastAPI Core:** Modern Python 3.12 application.
- **Neo4j Data Model:** Support for Entities, Documents, Chunks, and Memories with vector indexing.
- **Database Schema Initialization:** Automated creation of constraints and indexes.
- **Health Check:** `/health` endpoint to verify application and Neo4j connectivity.
- **Dockerized Setup:** Ready to run with Docker and Docker Compose.
- **Verification Suite:** Comprehensive tests for configuration, models, and structure.

## Setup

### Prerequisites
- Docker and Docker Compose
- Python 3.12+ (for local development)

### Environment Variables
Copy `.env.example` to `.env` and configure your API keys:
```bash
cp .env.example .env
# Ensure NEO4J_USER and NEO4J_PASSWORD are set in your .env file, as they are required for database access and have security constraints.
```

### Running with Docker
```bash
docker compose up -d
```
The API will be available at `http://localhost:8000`.

### Local Development
1. Create a virtual environment:
   ```bash
   python -m venv .venv
   source .venv/bin/activate
   pip install -e .
   ```
2. Run the development server:
   ```bash
   uvicorn app.main:app --reload
   ```

### Running Tests
```bash
pytest tests/
```

### Linting
```bash
ruff check . --fix
```
