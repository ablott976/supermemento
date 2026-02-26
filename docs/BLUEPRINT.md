# Supermemento — Blueprint v2

## 1. Visión General

Supermemento es un **reemplazo drop-in del servidor Memento MCP** que evoluciona un knowledge graph simple en una plataforma de memoria inteligente. Expone exactamente la misma interfaz MCP de tools que Memento — cualquier cliente (Claude, mcporter, n8n) puede cambiar con solo modificar la URL, sin cambios de código.

Sobre la compatibilidad total hacia atrás, añade: Smart Relations, Auto Forgetting, Multimodal Ingestion, SuperRAG retrieval, User Profiles y Connectors externos.

---

## 2. Tech Stack

- **Runtime**: Python 3.12, FastAPI 0.115+
- **Database**: Neo4j 5.x (Bolt directo vía `neo4j-driver`, connection pooling)
- **Embeddings**: OpenAI `text-embedding-3-large` (3072d), almacenados en Neo4j vector index
- **Background tasks**: APScheduler (cron in-process para forgetting, relaciones)
- **MCP transport**: SSE (Server-Sent Events) — mismo protocolo que Memento MCP actual
- **AI**: Claude Sonnet (smart relations, entity extraction), OpenAI (embeddings)
- **Web scraping**: Firecrawl API (ingest_url)
- **Deployment**: Docker → EasyPanel (proyecto `n8n`, servicio `n8n_supermemento`)
- **Testing**: pytest + pytest-asyncio, Neo4j test instance

### Env vars requeridas
```
NEO4J_URI=bolt://neo4j:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=<secret>
OPENAI_API_KEY=<secret>
ANTHROPIC_API_KEY=<secret>
FIRECRAWL_API_KEY=<secret>
MCP_SERVER_PORT=8000
LOG_LEVEL=info
```

---

## 3. Neo4j Data Model

Todas las entidades se almacenan en Neo4j. Este es el schema EXACTO que debe implementarse.

### Node Labels

| Label | Propiedades | Descripción |
|---|---|---|
| `:Entity` | `name` (str, unique), `entityType` (str), `observations` (list[str]), `embedding` (float[3072], nullable), `created_at` (datetime), `updated_at` (datetime), `last_accessed_at` (datetime), `access_count` (int, default 0), `status` (str, default "active") | Unidad de conocimiento core (backward compat con Memento) |
| `:Document` | `id` (uuid), `title` (str), `source_url` (str, nullable), `content_type` (enum: text/url/pdf/image/video/audio/conversation), `raw_content` (str), `container_tag` (str), `metadata` (json), `status` (enum: queued/extracting/chunking/embedding/indexing/done/error), `created_at` (datetime), `updated_at` (datetime) | Documento ingestado |
| `:Chunk` | `id` (uuid), `content` (str), `token_count` (int), `chunk_index` (int), `embedding` (float[3072]), `container_tag` (str), `metadata` (json), `source_doc_id` (uuid), `created_at` (datetime) | Fragmento de documento con embedding |
| `:Memory` | `id` (uuid), `content` (str), `memory_type` (enum: fact/preference/episode/derived), `container_tag` (str), `is_latest` (bool, default true), `confidence` (float 0-1), `embedding` (float[3072], nullable), `valid_from` (datetime), `valid_to` (datetime, nullable), `forgotten_at` (datetime, nullable), `source_doc_id` (uuid), `created_at` (datetime) | Hecho atómico extraído |
| `:User` | `user_id` (str, unique), `created_at` (datetime), `last_active_at` (datetime) | Usuario (multi-tenant) |

### Relationships

| Relación | Desde → Hacia | Propiedades | Semántica |
|---|---|---|---|
| `[:UPDATES]` | Memory → Memory | `classified_at`, `confidence` | B contradice/reemplaza A. A.is_latest=false |
| `[:EXTENDS]` | Memory → Memory | `classified_at`, `confidence` | B añade detalle a A sin contradecir |
| `[:DERIVES]` | Memory → Memory | `classified_at`, `confidence` | C inferido de A+B. confidence < hechos explícitos |
| `[:EXTRACTED_FROM]` | Memory → Document | `extracted_at` | Trazabilidad fuente |
| `[:PART_OF]` | Chunk → Document | | Chunk pertenece a Document |
| `[:BELONGS_TO]` | Entity/Memory/Document → User | | Multi-tenant ownership |
| `[:RELATES_TO]` | Entity → Entity | `relationType` (str) | Relaciones Memento existentes (backward compat) |

### Constraints e Indexes (idempotentes, ejecutar en startup)

```cypher
CREATE CONSTRAINT entity_name IF NOT EXISTS FOR (e:Entity) REQUIRE e.name IS UNIQUE;
CREATE CONSTRAINT memory_id IF NOT EXISTS FOR (m:Memory) REQUIRE m.id IS UNIQUE;
CREATE CONSTRAINT document_id IF NOT EXISTS FOR (d:Document) REQUIRE d.id IS UNIQUE;
CREATE CONSTRAINT chunk_id IF NOT EXISTS FOR (c:Chunk) REQUIRE c.id IS UNIQUE;
CREATE CONSTRAINT user_id IF NOT EXISTS FOR (u:User) REQUIRE u.user_id IS UNIQUE;

CREATE INDEX memory_container IF NOT EXISTS FOR (m:Memory) ON (m.container_tag);
CREATE INDEX memory_latest IF NOT EXISTS FOR (m:Memory) ON (m.is_latest);
CREATE INDEX memory_type IF NOT EXISTS FOR (m:Memory) ON (m.memory_type);
CREATE INDEX document_status IF NOT EXISTS FOR (d:Document) ON (d.status);

CALL db.index.vector.createNodeIndex('entity_embeddings', 'Entity', 'embedding', 3072, 'cosine');
CALL db.index.vector.createNodeIndex('memory_embeddings', 'Memory', 'embedding', 3072, 'cosine');
CALL db.index.vector.createNodeIndex('chunk_embeddings', 'Chunk', 'embedding', 3072, 'cosine');
```

---

## 4. MCP Tool Interfaces

Todos los tools son backward-compatible con Memento v1. Los nuevos tools se añaden, no se reemplazan.

### Tools existentes (backward compat — DEBEN funcionar idéntico a Memento)

| Tool | Params | Retorna |
|---|---|---|
| `create_entities` | `entities: [{name, entityType, observations}]` | Created entities |
| `add_observations` | `observations: [{entityName, contents: [str]}]` | Updated entities |
| `create_relations` | `relations: [{from, to, relationType}]` | Created relations |
| `search_nodes` | `query: str` | Matching entities (name/type/observation keyword match) |
| `semantic_search` | `query: str` | Matching entities by embedding similarity |
| `read_graph` | — | Full graph dump |

### Tools nuevos

| Tool | Params | Retorna | Fase |
|---|---|---|---|
| `ingest_url` | `url, container_tag, title?` | Document status | 5 |
| `ingest_text` | `content, container_tag, title?` | Document status | 5 |
| `get_user_profile` | `container_tag, regenerate?` | {static, dynamic} profile | 7 |
| `list_memories` | `container_tag, memory_type?, limit?` | Memories list | 7 |
| `superrag_search` | `query, container_tag?, search_mode?, rerank?, limit?` | Ranked results | 6 |

### semantic_search v2 (backward compat + nuevos params opcionales)

| Param | Tipo | Default | Descripción |
|---|---|---|---|
| `query` | str | requerido | Query de búsqueda |
| `container_tag` | str? | null | Filtrar por usuario/proyecto |
| `search_mode` | enum | "hybrid" | memory \| rag \| hybrid |
| `rerank` | bool | false | Activar cross-encoder reranking |
| `rewrite_query` | bool | false | Activar expansión de query |
| `limit` | int | 10 | Máximo resultados |
| `min_similarity` | float | 0.6 | Umbral mínimo |
| `memory_types` | str[]? | null | Filtrar: fact, preference, episode, derived |
| `include_expired` | bool | false | Incluir memorias con valid_to pasado |

---

## 5. Arquitectura del Código

```
app/
├── __init__.py
├── main.py              # FastAPI app, lifespan, CORS, routers
├── config.py            # Pydantic Settings
├── db/
│   ├── __init__.py
│   ├── neo4j.py         # Neo4j driver, connection pool, get_driver dependency
│   └── queries.py       # Cypher queries parametrizadas (NUNCA string concat)
├── mcp/
│   ├── __init__.py
│   ├── transport.py     # SSE endpoint /sse, MCP protocol handler
│   ├── tools.py         # Tool registry + dispatch
│   └── schemas.py       # MCP request/response Pydantic models
├── services/
│   ├── __init__.py
│   ├── embedding.py     # OpenAI embedding service (text-embedding-3-large)
│   ├── relation_classifier.py  # LLM classification pipeline (Fase 1)
│   ├── memory_extractor.py     # LLM memory extraction (Fase 3)
│   ├── ingestion.py     # Document ingestion pipeline
│   ├── forgetting.py    # Decay + cleanup jobs (Fase 2)
│   ├── profile.py       # User profile generation (Fase 5)
│   └── superrag.py      # HyDE + reranking + hybrid search (Fase 4)
├── models/
│   ├── __init__.py
│   ├── entity.py        # Entity Pydantic models
│   ├── memory.py        # Memory Pydantic models
│   ├── document.py      # Document Pydantic models
│   └── chunk.py         # Chunk Pydantic models
├── tools/
│   ├── __init__.py
│   ├── create_entities.py
│   ├── add_observations.py
│   ├── create_relations.py
│   ├── search_nodes.py
│   ├── semantic_search.py
│   ├── read_graph.py
│   ├── ingest_url.py
│   ├── ingest_text.py
│   ├── get_user_profile.py
│   ├── list_memories.py
│   └── superrag_search.py
└── jobs/
    ├── __init__.py
    ├── relation_detection.py   # Scheduled smart relation job
    ├── forgetting.py           # Scheduled decay/cleanup job
    └── profile_refresh.py      # Scheduled profile regeneration
tests/
├── conftest.py          # Neo4j test fixtures, mock driver
├── test_health.py
├── test_entities.py
├── test_observations.py
├── test_relations.py
├── test_search.py
├── test_semantic_search.py
├── test_read_graph.py
├── test_embedding.py
├── test_ingestion.py
├── test_forgetting.py
├── test_superrag.py
└── test_profile.py
```

### Reglas de arquitectura

- **Tools son stateless** — reciben driver como dependency, no mantienen estado
- **Queries en `db/queries.py`** — NUNCA Cypher inline en tools o services
- **Pydantic models en `models/`** — validación estricta de input/output
- **Services encapsulan lógica de negocio** — tools solo orquestan
- **Jobs son APScheduler tasks** — registrados en `main.py` lifespan
- **Tests con Neo4j mock** — no requieren instancia real para CI

---

## 6. Features con Dependencias

### Phase 0 — Foundation

**F-001: Project Structure + Configuration**
- Dependencies: ninguna
- Crear: pyproject.toml, Dockerfile, docker-compose.yml, .env.example, .gitignore, app/config.py, app/__init__.py
- Config: Pydantic Settings con todas las env vars de §2
- Docker: Python 3.12, multi-stage build, puerto 8000

**F-002: Neo4j Connection + Health Endpoint**
- Dependencies: F-001
- Driver async neo4j con connection pooling en app/db/neo4j.py
- GET /health → `{"status": "ok", "neo4j": "connected"}` (verifica conexión real)
- Constraint e indexes de §3 creados en startup (idempotentes)
- Tests: health endpoint con Neo4j mock

**F-003: MCP SSE Transport Layer**
- Dependencies: F-001
- Endpoint `/sse` con Server-Sent Events
- MCP protocol handler: parsear JSON-RPC, dispatch a tools
- Schemas Pydantic para MCP request/response en app/mcp/schemas.py
- Tool registry vacío (se puebla en fases siguientes)
- Tests: SSE connection, malformed request handling

### Phase 1 — Backward-Compatible Tools

**F-004: create_entities Tool**
- Dependencies: F-002, F-003
- Implementar `create_entities` — crea nodos :Entity en Neo4j
- Registrar en tool registry
- Query parametrizada en db/queries.py
- Tests: crear entidad, duplicado, validación

**F-005: add_observations Tool**
- Dependencies: F-004
- Implementar `add_observations` — añade observations a Entity existente
- Tests: añadir a existente, entity no encontrada

**F-006: create_relations Tool**
- Dependencies: F-004
- Implementar `create_relations` — crea relaciones [:RELATES_TO] entre entities
- Tests: crear relación, entities no existentes

**F-007: search_nodes Tool**
- Dependencies: F-004
- Implementar `search_nodes` — keyword search por name, entityType, observations
- Tests: búsqueda con resultados, sin resultados, case insensitive

**F-008: semantic_search Tool (keyword fallback)**
- Dependencies: F-004
- Implementar `semantic_search` — en Phase 1 usa keyword search (mismo que search_nodes)
- Acepta todos los params de §4 pero ignora los avanzados por ahora
- Será reemplazado por vector search en F-013
- Tests: búsqueda básica, params opcionales ignorados gracefully

**F-009: read_graph Tool**
- Dependencies: F-004, F-006
- Implementar `read_graph` — dump completo del grafo (entities + relations)
- Tests: grafo vacío, grafo con datos

### Phase 2 — Embeddings & Vector Search

**F-010: OpenAI Embedding Service**
- Dependencies: F-001
- app/services/embedding.py — wrapper para text-embedding-3-large
- Batch support (hasta 100 textos por request)
- Retry con exponential backoff
- Tests: mock OpenAI API, batch, error handling

**F-011: Neo4j Vector Index Setup**
- Dependencies: F-002
- Crear vector indexes (entity_embeddings, memory_embeddings, chunk_embeddings) en startup
- Idempotente (IF NOT EXISTS)
- Tests: verificar indexes creados

**F-012: Auto-embed on Entity Create/Update**
- Dependencies: F-004, F-010, F-011
- Hook en create_entities y add_observations → generar/actualizar embedding
- Async (no bloquear response)
- Tests: entity creada tiene embedding, observation update re-genera embedding

**F-013: Vector Semantic Search**
- Dependencies: F-011, F-012, F-008
- Reemplazar keyword fallback de F-008 con vector search real
- `db.index.vector.queryNodes('entity_embeddings', K, $embedding)`
- Mantener backward compat en interface
- Tests: búsqueda por similitud, threshold, límite

**F-014: Batch Embed Migration**
- Dependencies: F-010, F-012
- Script/endpoint para re-generar embeddings de entities existentes
- Progreso reportable
- Tests: migración de N entities

### Phase 3 — Smart Relations & Forgetting

**F-015: APScheduler Integration**
- Dependencies: F-001
- Configurar APScheduler en FastAPI lifespan
- Job registry en app/jobs/
- Tests: job registrado, ejecuta en schedule

**F-016: Smart Relation Detection Job**
- Dependencies: F-006, F-010, F-015
- app/services/relation_classifier.py — LLM classification pipeline
- Busca candidatos por vector similarity (cosine >= 0.75, top 10)
- Clasifica con Claude Sonnet: UPDATE, EXTEND, DERIVE, NONE
- Crea relaciones [:UPDATES], [:EXTENDS], [:DERIVES]
- Actualiza is_latest en UPDATEs
- Tests: clasificación mock, aplicación de relaciones

**F-017: Access Tracking**
- Dependencies: F-007, F-008
- Hook en search_nodes y semantic_search → incrementar access_count, update last_accessed_at
- Tests: búsqueda incrementa contador

**F-018: Entity Scoring + Archival Job**
- Dependencies: F-015, F-017
- Job periódico: calcular decay de confidence según memory_type y half-life
- fact: sin decay, preference: 180 días, episode: 7 días post-validTo, derived: 90 días
- Soft-delete si confidence < 0.1 (SET forgotten_at)
- Tests: decay calculation, archival

**F-019: Hard Delete Job**
- Dependencies: F-018
- Job periódico: eliminar nodos con forgotten_at > 30 días
- Tests: cleanup de nodos antiguos

### Phase 4 — Document Ingestion

**F-020: Document Chunking Pipeline**
- Dependencies: F-010
- app/services/ingestion.py — pipeline de chunking
- Estrategias por content_type (texto: semántico 512-1024 tokens, conversación: por turno)
- Crea nodos :Chunk con embeddings
- Tests: chunking de texto, embedding de chunks

**F-021: ingest_url Tool**
- Dependencies: F-003, F-020
- Scrape URL con Firecrawl API → crear :Document → pipeline chunking
- Registrar en tool registry
- Tests: mock Firecrawl, document creado

**F-022: ingest_text Tool**
- Dependencies: F-003, F-020
- Crear :Document desde texto directo → pipeline chunking
- Registrar en tool registry
- Tests: document + chunks creados

**F-023: Auto Entity Extraction from Documents**
- Dependencies: F-004, F-020
- LLM extrae hechos atómicos de cada chunk → crea :Memory nodes
- Relación [:EXTRACTED_FROM] hacia :Document
- Clasificación memory_type (fact/preference/episode)
- Detección temporal automática (validFrom/validTo)
- Tests: extracción mock, memories creadas con tipos correctos

### Phase 5 — SuperRAG

**F-024: HyDE Search**
- Dependencies: F-013
- Hypothetical Document Embedding: expandir query con Claude Haiku
- Generar embedding del documento hipotético → buscar por similitud
- Tests: expansión de query, mejora de recall

**F-025: Reranking Pipeline**
- Dependencies: F-013
- Cross-encoder reranking post-retrieval (Cohere Rerank API o self-hosted)
- Parámetro `rerank: true` en semantic_search
- Tests: reranking mejora ordering

**F-026: Hybrid BM25+Vector Search**
- Dependencies: F-013
- Combinar keyword (BM25-like) + vector search
- Búsqueda en :Memory + :Chunk (hybrid mode)
- Merge y dedup de resultados
- Tests: hybrid devuelve de ambas fuentes

**F-027: superrag_search Unified Tool**
- Dependencies: F-003, F-024, F-025, F-026
- Orquesta HyDE + hybrid search + reranking
- search_mode: memory | rag | hybrid
- Registrar en tool registry
- Tests: end-to-end con mocks

### Phase 6 — User Profiles

**F-028: User Node + Multi-user Support**
- Dependencies: F-004
- Crear nodos :User, relaciones [:BELONGS_TO]
- Filtrado por user_id en todas las queries
- Tests: multi-user isolation

**F-029: get_user_profile Tool**
- Dependencies: F-003, F-028
- Generar perfil (static + dynamic) con Claude Sonnet
- Cache en propiedad del :User node
- Registrar en tool registry
- Tests: perfil generado, cache hit

**F-030: list_memories Tool**
- Dependencies: F-003, F-028
- Listar memories de un user, filtrar por tipo
- Registrar en tool registry
- Tests: listado con filtros

### Phase 7 — Connectors & Deployment

**F-031: Webhook Ingestion Endpoint**
- Dependencies: F-020
- POST /ingest/webhook — authenticated endpoint
- Acepta JSON con content + metadata → pipeline ingestion
- API key auth
- Tests: auth, ingestion triggered

**F-032: Containerized Deploy**
- Dependencies: F-002, F-003
- Dockerfile multi-stage optimizado
- docker-compose.yml con Neo4j + Supermemento + volumes
- .env.example con todas las vars
- Health check en compose
- Tests: docker build succeeds, compose up healthy

**F-033: Backward-Compatibility Regression Tests**
- Dependencies: F-004, F-005, F-006, F-007, F-008, F-009
- Suite de regression que valida los 6 tools de Memento v1
- Cada test replica comportamiento exacto de Memento
- CI gate: si regression falla, no se puede mergear
- Tests: 6 tools × N scenarios = comprehensive regression

---

## 7. Relation Classification Pipeline (detail for F-016)

### LLM Prompt (Claude Sonnet)

```
Eres un clasificador de relaciones entre memorias. Dado un NUEVO HECHO
y una lista de HECHOS EXISTENTES, determina para cada par qué relación aplica.

Relaciones posibles:
- UPDATE: el nuevo contradice/reemplaza el existente
- EXTEND: el nuevo añade detalle sin contradecir
- DERIVE: se puede inferir un nuevo hecho de la combinación
- NONE: no hay relación significativa

Responde SOLO en JSON: {relations: [{existingMemoryId, relationType, confidence, derivedFact?}]}
```

### Coste por operación
- Embedding: ~$0.00006
- Vector Search: $0 (local Neo4j)
- Clasificación LLM: ~$0.003
- **Total por memoria: ~$0.003** (~$9/mes para 100 memorias/día)

---

## 8. Memory Decay Rules (detail for F-018)

| Tipo | Half-life | Decay |
|---|---|---|
| fact | ∞ | Sin decay — persiste hasta UPDATE |
| preference | 180 días | Se refuerza con repetición (+0.15 confidence) |
| episode | 7 días post-validTo | Soft-delete cuando confidence < 0.1 |
| derived | 90 días | Invalidable por nuevos hechos |

Formula: `nueva_confidence = original * (0.5 ^ (días / half_life))`

---

## 9. Estimación de Costes

| Componente | Volumen/mes | Coste/mes |
|---|---|---|
| Embeddings (3-large) | 3000 docs | ~$2 |
| Clasificación LLM (Sonnet) | 3000 calls | ~$9 |
| Extracción LLM (Sonnet) | 1500 calls | ~$7.5 |
| Query Rewriting (Haiku) | 1500 calls | ~$0.45 |
| Reranking (Cohere) | 500 calls | ~$1 |
| Neo4j + hosting | — | $0 (ya pagado) |
| **TOTAL** | | **~$20/mes** |
