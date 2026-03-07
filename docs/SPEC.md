# MEMENTO v2.0 — Intelligent Memory Infrastructure

## Documento de Desarrollo Completo
**Replicando las fortalezas de Supermemory sobre infraestructura self-hosted**

**Autor:** Arturo Blott  
**Fecha:** 18 de febrero de 2026  
**Versión:** 1.0 - Documento de Máximos

---

## 1. Resumen Ejecutivo

Este documento define la arquitectura completa de Memento v2.0, una evolución del sistema actual de knowledge graph basado en Neo4j/MCP hacia una plataforma de memoria inteligente para agentes de IA. El objetivo es replicar y en algunos casos superar las capacidades de Supermemory.ai, manteniendo las ventajas fundamentales de nuestro sistema: control total, soberanía de datos, y transparencia del grafo.

Para configurar el entorno de desarrollo local (instalación de dependencias, variables de entorno, export de variables al shell, inicialización del schema de Neo4j y ejecución en modo desarrollo), ver la sección [Getting Started](../README.md#getting-started) en el README.

### 1.1 Objetivo
Transformar Memento de un knowledge graph estático con escritura manual a un sistema de memoria dinámico que:
- Extrae hechos automáticamente del contenido
- Gestiona relaciones inteligentes entre memorias (updates, extends, derives)
- Olvida información temporal automáticamente
- Ingesta documentos multimodales
- Ofrece RAG avanzado con reranking y query rewriting
- Genera perfiles de usuario automáticos

### 1.2 Stack Tecnológico

| Componente | Tecnología Actual | Memento v2.0 |
|---|---|---|
| Base de datos grafo | Neo4j (bolt://n8n_neo4j:7687) | Neo4j (sin cambio) |
| Embeddings | text-embedding-3-small (1536d) | text-embedding-3-large (3072d) |
| Vector Index | entity_embeddings (cosine) | entity_embeddings + chunk_embeddings |
| Orquestación | n8n workflows | n8n workflows + cron jobs |
| MCP Server | Memento MCP | Memento MCP v2 (nuevos tools) |
| LLM para procesamiento | No aplica | Claude Sonnet 4.6 via API |
| Pipeline de ingesta | Manual | Automático (n8n + Firecrawl + parsers) |
| Almacenamiento de archivos | No aplica | MinIO / volumen Docker |

### 1.3 Fases de Implementación

| Fase | Alcance | Duración Est. | Prioridad |
|---|---|---|---|
| Fase 1 | Relaciones inteligentes (Updates/Extends/Derives) | 2-3 semanas | CRÍTICA |
| Fase 2 | Olvido automático y clasificación de memorias | 1-2 semanas | CRÍTICA |
| Fase 3 | Ingesta multimodal (docs, web, audio) | 3-4 semanas | ALTA |
| Fase 4 | SuperRAG (reranking, query rewriting, chunking) | 2-3 semanas | ALTA |
| Fase 5 | User Profiles automáticos | 1-2 semanas | MEDIA |
| Fase 6 | Conectores y sincronización | 2-3 semanas | MEDIA |

---

## 2. Arquitectura del Sistema

### 2.1 Modelo Mental: Documents vs Memories
Supermemory distingue entre Documents (input crudo) y Memories (unidades de conocimiento inteligentes). Memento v2 adopta esta distinción añadiendo dos nuevos tipos de nodo al grafo:

| Concepto | Definición | Nodo Neo4j |
|---|---|---|
| Document | Archivo o contenido crudo ingresado por el usuario (PDF, URL, texto, transcripción) | (:Document) |
| Memory | Hecho atómico extraído de un Document, con embeddings y metadatos temporales | (:Memory) |
| Entity | Entidad existente en Memento actual. Se mantiene como contenedor de alto nivel | (:Entity) - existente |
| Relation | Relación entre entidades. Se mantiene sin cambios | [:RELATES_TO] - existente |

### 2.2 Schema Neo4j Extendido

#### Nodo :Document
Representa el contenido fuente ingresado al sistema.

| Propiedad | Tipo | Descripción |
|---|---|---|
| id | UUID | Identificador único |
| title | String | Título del documento |
| contentType | Enum | text \| url \| pdf \| image \| video \| audio \| conversation |
| rawContent | String | Contenido extraído (texto plano) |
| sourceUrl | String? | URL de origen si aplica |
| filePath | String? | Ruta al archivo en MinIO/volumen |
| containerTag | String | Identificador del usuario/proyecto/entidad propietaria |
| metadata | JSON | Metadata libre (autor, fecha original, tags) |
| status | Enum | queued \| extracting \| chunking \| embedding \| indexing \| done \| error |
| createdAt | DateTime | Fecha de ingesta |
| updatedAt | DateTime | Última actualización |

#### Nodo :Memory
Unidad atómica de conocimiento extraída de un Document.

| Propiedad | Tipo | Descripción |
|---|---|---|
| id | UUID | Identificador único |
| content | String | El hecho en lenguaje natural (ej: 'Arturo trabaja en ZKTeco Europe') |
| memoryType | Enum | fact \| preference \| episode \| derived |
| containerTag | String | Mismo containerTag que el Document padre |
| isLatest | Boolean | true si es la versión más reciente de este hecho |
| confidence | Float 0-1 | Confianza en la extracción |
| embedding | Float[3072] | Vector embedding (text-embedding-3-large) |
| validFrom | DateTime? | Inicio de validez temporal |
| validTo | DateTime? | Fin de validez temporal (null = permanente) |
| forgottenAt | DateTime? | Fecha de soft-delete si fue olvidado |
| createdAt | DateTime | Fecha de creación |
| sourceDocId | UUID | Referencia al Document fuente |

#### Relaciones entre Memories

| Relación | Semántica | Comportamiento |
|---|---|---|
| [:UPDATES] | Memory B contradice/reemplaza Memory A | A.isLatest = false, B.isLatest = true. Búsquedas devuelven B. A se conserva como histórico. |
| [:EXTENDS] | Memory B añade detalle a Memory A sin reemplazarla | Ambas isLatest = true. Búsquedas devuelven ambas para contexto más rico. |
| [:DERIVES] | Memory C se infiere de la combinación de A + B | C.memoryType = 'derived'. Se marca con confidence menor que hechos explícitos. |
| [:EXTRACTED_FROM] | Memory fue extraída de un Document | Trazabilidad. Permite auditar qué hechos vienen de qué fuente. |

### 2.3 Compatibilidad con Memento v1
Memento v2 NO rompe el sistema actual. Los nodos :Entity y sus observaciones siguen funcionando. La migración es incremental: las entidades existentes pueden convivir con los nuevos nodos :Document y :Memory. Un workflow de migración opcional puede convertir observaciones de Entity existentes a nodos :Memory para beneficiarse de las nuevas relaciones.

---

## 3. Fase 1: Relaciones Inteligentes

Esta es la mejora más crítica. Actualmente Memento guarda hechos sin verificar si contradicen, extienden o se infieren de hechos existentes. Esto provoca redundancia, contradicciones silenciosas, y un grafo que crece sin inteligencia.

### 3.1 Pipeline de Clasificación de Relaciones
Cada vez que se añade una nueva Memory al sistema, se ejecuta el siguiente pipeline:

**Paso 1: Búsqueda de candidatos**
Buscar en el mismo containerTag las memorias semánticamente más cercanas al nuevo hecho usando el vector index de Neo4j. Umbral: cosine similarity >= 0.75. Máximo: 10 candidatos.

**Paso 2: Clasificación LLM**
Enviar el nuevo hecho + candidatos a Claude Sonnet 4.6 con el siguiente prompt de clasificación:

```
SYSTEM PROMPT para clasificación:
"Eres un clasificador de relaciones entre memorias. Dado un NUEVO HECHO y una lista de HECHOS EXISTENTES, determina para cada par qué relación aplica. Responde SOLO en JSON.

Relaciones posibles:
- UPDATE (el nuevo contradice/reemplaza el existente)
- EXTEND (el nuevo añade detalle sin contradecir)
- DERIVE (se puede inferir un nuevo hecho de la combinación)
- NONE (no hay relación significativa)

Para UPDATE: el nuevo hecho debe contradecir directamente el existente. Ejemplo: 'trabaja en Google' -> 'trabaja en Stripe'.
Para EXTEND: el nuevo hecho añade información al mismo tema. Ejemplo: 'trabaja en Stripe' -> 'lidera equipo de pagos en Stripe'.
Para DERIVE: la combinación de hechos permite inferir algo nuevo. Ejemplo: 'es PM en Stripe' + 'habla frecuentemente de APIs de pago' -> 'probablemente trabaja en el producto core de pagos de Stripe'.

Responde con: {relations: [{existingMemoryId, relationType, confidence, derivedFact?}]}"
```

**Paso 3: Aplicación de relaciones**
Basado en la respuesta del LLM:

| Relación | Acción en Neo4j |
|---|---|
| UPDATE | CREATE (newMemory)-[:UPDATES]->(existingMemory), SET existingMemory.isLatest = false |
| EXTEND | CREATE (newMemory)-[:EXTENDS]->(existingMemory) |
| DERIVE | CREATE (:Memory {content: derivedFact, memoryType: 'derived', confidence: 0.6}), CREATE relaciones [:DERIVES] desde las memorias fuente |
| NONE | No crear relación. La memoria se guarda como hecho independiente. |

### 3.2 Implementación Técnica
**N8n Workflow: memory-relation-classifier**

Trigger: Webhook POST desde el pipeline de ingesta cuando una nueva Memory se crea.

| Nodo | Tipo | Función |
|---|---|---|
| 1. Recibir Memory | Webhook | Recibe {memoryId, content, containerTag, embedding} |
| 2. Buscar Candidatos | Neo4j Query | CALL db.index.vector.queryNodes('entity_embeddings', 10, $embedding) YIELD node, score WHERE score >= 0.75 AND node.containerTag = $tag |
| 3. Clasificar | HTTP Request (Anthropic API) | Envía nuevo hecho + candidatos. Modelo: claude-sonnet-4-6. Max tokens: 1000. |
| 4. Parsear JSON | Code Node | Valida y parsea la respuesta JSON del LLM |
| 5. Aplicar Relaciones | Neo4j Query (loop) | Ejecuta las queries Cypher según cada relación clasificada |
| 6. Actualizar Status | Neo4j Query | SET memory.status = 'indexed' |

### 3.3 Coste Estimado por Operación
Para un volumen de ~100 memorias/día: ~$0.30/día, ~$9/mes.

| Operación | Tokens Input | Tokens Output | Coste aprox (Sonnet 4.6) |
|---|---|---|---|
| Embedding (3-large) | ~50 tokens | N/A | $0.00006 |
| Vector Search Neo4j | N/A | N/A | $0 (local) |
| Clasificación LLM | ~500 tokens | ~200 tokens | $0.003 |
| TOTAL por memoria | | | ~$0.003 |

---

## 4. Fase 2: Olvido Automático

Supermemory distingue automáticamente entre hechos permanentes, preferencias que se refuerzan, y episodios que decaen. Nuestro sistema actual trata todo igual. Esto llena el grafo de ruido temporal.

### 4.1 Clasificación de Tipos de Memoria

| Tipo | Ejemplo | Comportamiento | Decay |
|---|---|---|---|
| fact | 'Arturo trabaja en ZKTeco Europe' | Persiste hasta que un UPDATE lo reemplace | Sin decay |
| preference | 'Prefiere presentaciones minimalistas' | Se refuerza con repetición. Confidence sube. | Decay lento (half-life: 180 días) |
| episode | 'Reunión con Daniel sobre KPIs mañana' | Tiene validTo explícito. Se olvida tras expirar. | Decay rápido (half-life: 7 días post-validTo) |
| derived | 'Probablemente responsable de estrategia WFM Francia' | Inferido. Confidence < 0.7. Puede ser invalidado. | Decay medio (half-life: 90 días) |

### 4.2 Detección Temporal Automática
El LLM que extrae memorias debe detectar referencias temporales y asignar validTo.

Prompt adicional para el extractor:
```
"Si el hecho contiene una referencia temporal ('mañana', 'la semana que viene', 'el 15 de marzo', 'hoy'), calcula la fecha absoluta basada en la fecha actual y asigna validTo. Si el hecho es atemporal, validTo = null."
```

| Texto Original | validFrom | validTo | memoryType |
|---|---|---|---|
| 'Tengo reunión con Daniel mañana a las 10' | 2026-02-18 | 2026-02-19T23:59:59 | episode |
| 'El lanzamiento de v2 es en marzo' | 2026-02-18 | 2026-03-31T23:59:59 | episode |
| 'Arturo prefiere documentos en español' | 2026-02-18 | null | preference |
| 'ZKTeco compite con Kelio en Francia' | 2026-02-18 | null | fact |

### 4.3 Job de Limpieza (Cron)
Un workflow de n8n programado cada 24 horas ejecuta:

**4.3.1 Soft-delete de episodios expirados**
```cypher
MATCH (m:Memory)
WHERE m.memoryType = 'episode'
AND m.validTo < datetime()
AND m.forgottenAt IS NULL
SET m.forgottenAt = datetime()
```

**4.3.2 Decay de confidence**
Para memorias con decay aplicable (preference, derived), recalcular confidence basado en half-life:
```
nueva_confidence = confidence_original * (0.5 ^ (dias_desde_creacion / half_life))
```
Si nueva_confidence < 0.1: soft-delete (`SET forgottenAt = datetime()`).

**4.3.3 Refuerzo de preferencias**
Cuando la Fase 1 detecta un EXTEND sobre una preferencia existente, incrementar confidence:
```cypher
SET preference.confidence = MIN(1.0, preference.confidence + 0.15)
```

### 4.4 Resolución de Contradicciones
Cuando la Fase 1 detecta un UPDATE, la contradicción se resuelve automáticamente marcando la memoria antigua con `isLatest = false`. Las búsquedas por defecto filtran `WHERE isLatest = true`, pero el historial completo permanece accesible para auditoría.

---

## 5. Fase 3: Ingesta Multimodal

Supermemory acepta texto, PDFs, imágenes, vídeos, URLs y conversaciones. Nuestro Memento actual solo recibe texto vía MCP tools. Esta fase construye un pipeline de ingesta completo.

### 5.1 Pipeline de Procesamiento

| Etapa | Status | Acción | Herramientas |
|---|---|---|---|
| 1. Recepción | queued | Documento recibido vía API/MCP/webhook. Se crea nodo :Document. | MCP Tool / n8n Webhook |
| 2. Extracción | extracting | Extraer texto según contentType. | Ver tabla 5.2 |
| 3. Chunking | chunking | Dividir en chunks semánticos según tipo de contenido. | Ver sección 5.3 |
| 4. Extracción de Memorias | extracting_memories | LLM extrae hechos atómicos de cada chunk. | Claude Sonnet 4.6 |
| 5. Embedding | embedding | Generar vector para cada Memory. | text-embedding-3-large |
| 6. Indexación | indexing | Clasificar relaciones (Fase 1) y guardar en Neo4j. | Pipeline Fase 1 |
| 7. Completado | done | Documento totalmente procesado y buscable. | N/A |

### 5.2 Extractores por Tipo de Contenido

| Tipo | Extractor | Implementación |
|---|---|---|
| text | Directo | El contenido ya es texto. Sin procesamiento. |
| url | Firecrawl Scrape | Llamada a firecrawl_scrape con formats: ['markdown'], onlyMainContent: true |
| pdf | PyMuPDF + OCR fallback | pip install pymupdf. Si no hay texto: pytesseract OCR. |
| image | Claude Vision | Enviar imagen a Claude con prompt de extracción de texto/descripción. |
| video | Whisper + frames | Transcripción con OpenAI Whisper. Frames clave cada 30s con Claude Vision. |
| audio | Whisper | Transcripción directa con OpenAI Whisper API. |
| conversation | Parser de turnos | Parsear formato de chat (speaker: message). Cada turno es contexto. |

### 5.3 Estrategias de Chunking Inteligente

| Tipo de Contenido | Estrategia de Chunking | Tamaño Objetivo |
|---|---|---|
| Documentos (PDF, DOCX) | Por secciones semánticas: headers, párrafos, límites lógicos | 512-1024 tokens |
| Código | Por AST: funciones, clases, métodos como unidades. Imports agrupados. | Por función/método |
| Páginas web | Por estructura HTML: headings, párrafos, listas. Eliminar nav/ads. | 512-1024 tokens |
| Markdown | Por jerarquía de headings. Respetar estructura del documento. | 512-1024 tokens |
| Conversaciones | Por turno de speaker o grupo de turnos temáticos. | Por tema (3-5 turnos) |
| Transcripciones | Por tema/speaker change con timestamps. | 2-5 minutos de audio |

### 5.4 Extracción de Memorias (LLM)

```
SYSTEM PROMPT para extracción:
"Eres un extractor de hechos. Dado un fragmento de texto, extrae TODOS los hechos atómicos. Cada hecho debe ser una afirmación independiente y autónoma que tenga sentido sin contexto adicional.

Para cada hecho, determina:
- content (el hecho en lenguaje natural)
- memoryType (fact, preference, episode)
- confidence (0.0-1.0)
- validFrom (fecha actual)
- validTo (null si permanente, fecha si temporal)

Reglas:
- No incluyas opiniones del texto, solo hechos verificables.
- Resuelve pronombres ('ella' -> nombre concreto si disponible).
- Detecta referencias temporales y calcula fechas absolutas.
- Si el hecho es una preferencia del usuario, marca como 'preference'.

Responde SOLO en JSON: {memories: [{content, memoryType, confidence, validFrom, validTo}]}"
```

### 5.5 Filter Prompts Configurables
Permitir configurar un filterPrompt por containerTag que guíe qué contenido indexar y cuál ignorar.

Ejemplos:
- ZKTeco: *'Priorizar: inteligencia competitiva, decisiones estratégicas, terminología validada, KPIs de producto. Ignorar: conversaciones informales, contenido duplicado, borradores no validados.'*
- Ancora: *'Priorizar: preferencias de clientes, configuraciones de automatización, flujos de reservas. Ignorar: datos de prueba, logs técnicos.'*

El filterPrompt se almacena como propiedad del containerTag en Neo4j y se inyecta como contexto adicional al LLM extractor.

### 5.6 Nuevos MCP Tools

| Tool | Parámetros | Función |
|---|---|---|
| ingest_document | content, contentType, containerTag, title?, metadata? | Inicia pipeline de ingesta. Crea :Document y encola procesamiento. |
| ingest_url | url, containerTag, title? | Scrape URL con Firecrawl, luego pipeline estándar. |
| ingest_conversation | messages[], containerTag | Procesa historial de conversación y extrae memorias. |
| get_document_status | documentId | Consulta estado del pipeline de un documento. |
| list_documents | containerTag, status?, limit? | Lista documentos por containerTag y status. |

---

## 6. Fase 4: SuperRAG

### 6.1 Arquitectura de Búsqueda Híbrida

#### Nodo :Chunk (nuevo)

| Propiedad | Tipo | Descripción |
|---|---|---|
| id | UUID | Identificador único |
| content | String | Texto del chunk |
| embedding | Float[3072] | Vector embedding |
| chunkIndex | Integer | Posición dentro del documento |
| containerTag | String | Mismo que el Document padre |
| metadata | JSON | Headers, posición, contexto del chunk |
| sourceDocId | UUID | Referencia al Document fuente |

Índices vectoriales:

| Indice | Nodos | Función |
|---|---|---|
| entity_embeddings (existente) | :Memory, :Entity | Búsqueda de hechos extraídos y entidades |
| chunk_embeddings (nuevo) | :Chunk | Búsqueda sobre chunks crudos de documentos (RAG clásico) |

### 6.2 Modos de Búsqueda

| Modo | Qué busca | Cuándo usar |
|---|---|---|
| memory | Solo :Memory nodes (hechos extraídos) | Preguntas sobre el usuario/contexto personal |
| rag | Solo :Chunk nodes (fragmentos de documentos) | Preguntas sobre contenido de documentos |
| hybrid (default) | Ambos: :Memory + :Chunk, merged y ranked | Default. Combina conocimiento personal + documental. |

### 6.3 Reranking
Después del retrieval inicial (top-K por cosine similarity), aplicar un cross-encoder para re-evaluar la relevancia real de cada resultado respecto a la query original.

**Opción A (recomendada):** Cohere Rerank API. Coste: ~$1/1000 queries. Latencia: +100-200ms.
**Opción B (self-hosted):** Modelo cross-encoder/ms-marco-MiniLM-L-6-v2 en un contenedor Docker con FastAPI. Coste: solo compute. Latencia: +50-100ms.

### 6.4 Query Rewriting
Cuando la query del usuario es corta o ambigua, expandirla para mejorar el recall.

Ejemplo: `'auth en Stripe'` -> `'autenticación OAuth JWT tokens Stripe payment API security'`

Implementación: Claude Haiku con prompt de expansión. Coste: ~$0.0003 por query.

### 6.5 Contextual Chunking
Cada chunk incluye contexto del documento:
- Antes del chunk: headers/títulos de las secciones padre (breadcrumb)
- Después: un resumen de una línea del documento completo

### 6.6 MCP Tool Actualizado: semantic_search v2

| Parámetro | Tipo | Default | Descripción |
|---|---|---|---|
| query | String | requerido | Query de búsqueda |
| containerTag | String? | null | Filtrar por usuario/proyecto |
| searchMode | Enum | hybrid | memory \| rag \| hybrid |
| rerank | Boolean | false | Activar cross-encoder reranking |
| rewriteQuery | Boolean | false | Activar expansión de query |
| limit | Integer | 10 | Máximo resultados |
| min_similarity | Float | 0.6 | Umbral mínimo de similaridad |
| memoryTypes | String[]? | null | Filtrar por tipo: fact, preference, episode, derived |
| includeExpired | Boolean | false | Incluir memorias con validTo pasado |

---

## 7. Fase 5: User Profiles Automáticos

### 7.1 Estructura del Perfil

| Sección | Contenido | Fuente | Actualización |
|---|---|---|---|
| Estático | Nombre, rol, empresa, expertise, preferencias de comunicación | Memorias tipo 'fact' y 'preference' con alta confidence | Cuando se añade/actualiza un fact o preference |
| Dinámico | Proyectos activos, tareas pendientes, últimas conversaciones, contexto reciente | Memorias tipo 'episode' recientes + tareas de PostgreSQL | Cada 24h o bajo demanda |

### 7.2 Generación del Perfil
Job periódico (cada 24h o bajo demanda):
1. Recuperar todas las memorias isLatest=true del containerTag del usuario.
2. Agrupar por memoryType (facts, preferences, episodes).
3. Recuperar tareas pendientes de PostgreSQL (v_pending).
4. Enviar a Claude Sonnet 4.6 con prompt de generación de perfil.

```
PROMPT de generación:
"Genera un perfil de usuario conciso basado en los hechos proporcionados. Divide en:
STATIC (hechos permanentes sobre identidad, rol, preferencias) y
DYNAMIC (proyectos activos, tareas recientes, contexto temporal).
El perfil debe ser útil como system prompt para un LLM que va a interactuar con este usuario.
Máximo 500 palabras."
```

### 7.3 MCP Tool: get_user_profile

| Parámetro | Tipo | Descripción |
|---|---|---|
| containerTag | String | Identificador del usuario |
| regenerate | Boolean (default: false) | Forzar regeneración del perfil |
| includeSearch | Boolean (default: false) | Incluir resultados de búsqueda relevantes al contexto actual |

---

## 8. Fase 6: Conectores y Sincronización

### 8.1 Conectores Priorizados

| Conector | Prioridad | Caso de Uso | Implementación |
|---|---|---|---|
| Web Crawler | ALTA | Monitorizar webs de competidores, documentación de productos, noticias del sector | n8n workflow con Firecrawl. Cron cada 24h. Detectar cambios con changeTracking. |
| Google Drive | ALTA | Sincronizar documentos de ZKTeco (presentaciones, reports, datasheets) | n8n node de Google Drive. Watch trigger para nuevos/modificados. Pipeline de ingesta. |
| WhatsApp/Chat | MEDIA | Ingestar conversaciones de soporte de Ancora, chats con partners | n8n webhook desde WhatsApp Business API. Parser de conversación. |
| Notion | BAJA | Si se adopta Notion como wiki interna | API de Notion + webhook. Solo si hay adopción real. |
| Email/Gmail | BAJA | Ingestar emails relevantes de partners/clientes | Gmail API con filtros. Solo emails etiquetados manualmente. |

### 8.2 Arquitectura de Conectores
Cada conector es un workflow de n8n independiente:
1. **Trigger:** Cron (polling) o Webhook (push) según la fuente.
2. **Fetch:** Obtener contenido nuevo/modificado desde la fuente.
3. **Dedup:** Verificar si el documento ya existe en Memento (por sourceUrl o hash).
4. **Ingest:** Enviar al pipeline de ingesta (Fase 3) con el containerTag correspondiente.
5. **Status:** Actualizar estado de sincronización.

### 8.3 Web Crawler para Inteligencia Competitiva
Monitorizar automáticamente las webs de competidores (Kelio/Bodet, Kronos, ADP) y extraer cambios en productos, precios, y messaging.

Workflow: Cron diario → Lista de URLs monitorizadas → Firecrawl scrape con changeTracking → Si hay cambios: pipeline de ingesta con containerTag = 'competitive-intel' → Notificación a Slack/email.

---

## 9. Protocolo de Validación v3.0

### 9.1 Filtros Existentes (se mantienen)

| Filtro | Pregunta | Acción si falla |
|---|---|---|
| Relevancia | ¿Este resultado responde directamente a la pregunta? | Descartar |
| Recencia | ¿Este dato es actual (<3 meses) o está desactualizado? | Verificar con isLatest / validTo |
| Consistencia | ¿Múltiples resultados se contradicen? | Priorizar isLatest = true |
| Aplicabilidad | ¿Esto aplica a ESTE caso específico? | Verificar containerTag |

### 9.2 Filtros Nuevos

| Filtro | Pregunta | Acción si falla |
|---|---|---|
| Provenance | ¿De qué Document viene esta Memory? ¿Es una fuente confiable? | Verificar sourceDocId. Priorizar fuentes oficiales. |
| Tipo de Memoria | ¿Es un fact, preference, episode o derived? | Ajustar confidence según tipo. derived < fact. |
| Temporal | ¿Esta memoria ha expirado (validTo < now)? | Filtrar por defecto. Incluir solo con includeExpired: true. |
| Derivación | ¿Es una inferencia (derived)? ¿Cuál es su confidence? | Si confidence < 0.5, marcar como especulativo. |

---

## 10. Plan de Migración

### 10.1 Pasos de Migración

1. **Schema Extension:** Añadir constraints e índices para :Document, :Memory, :Chunk en Neo4j. No afecta nodos existentes.
2. **Upgrade Embedding Model:** Migrar de text-embedding-3-small (1536d) a text-embedding-3-large (3072d). Crear nuevo vector index. Re-generar embeddings para entidades existentes con batch job.
3. **Observaciones a Memories:** Script de migración que convierte observaciones de :Entity existentes a nodos :Memory con relación [:EXTRACTED_FROM] apuntando a un :Document placeholder. Clasificar memoryType con LLM.
4. **Deploy Pipelines:** Activar workflows de n8n uno por uno: primero clasificación de relaciones (Fase 1), luego olvido automático (Fase 2), luego ingesta (Fase 3), etc.
5. **MCP Server v2:** Deploy del MCP server actualizado con los nuevos tools. Los tools existentes (semantic_search, create_entities, etc.) siguen funcionando sin cambios.

### 10.2 Queries Cypher de Setup

```cypher
-- Constraints e Índices
CREATE CONSTRAINT memory_id IF NOT EXISTS FOR (m:Memory) REQUIRE m.id IS UNIQUE
CREATE CONSTRAINT document_id IF NOT EXISTS FOR (d:Document) REQUIRE d.id IS UNIQUE
CREATE CONSTRAINT chunk_id IF NOT EXISTS FOR (c:Chunk) REQUIRE c.id IS UNIQUE
CREATE INDEX memory_container IF NOT EXISTS FOR (m:Memory) ON (m.containerTag)
CREATE INDEX memory_latest IF NOT EXISTS FOR (m:Memory) ON (m.isLatest)
CREATE INDEX memory_type IF NOT EXISTS FOR (m:Memory) ON (m.memoryType)
CREATE INDEX document_status IF NOT EXISTS FOR (d:Document) ON (d.status)

-- Vector Index para Memories
CALL db.index.vector.createNodeIndex('memory_embeddings', 'Memory', 'embedding', 3072, 'cosine')

-- Vector Index para Chunks
CALL db.index.vector.createNodeIndex('chunk_embeddings', 'Chunk', 'embedding', 3072, 'cosine')
```

---

## 11. Estimación de Costes

| Componente | Operación | Volumen/mes | Coste unitario | Coste/mes |
|---|---|---|---|---|
| Embeddings | text-embedding-3-large | 3000 docs | $0.00013/1K tokens | ~$2 |
| Clasificación LLM | Sonnet 4.6 (relaciones) | 3000 calls | $0.003/call | ~$9 |
| Extracción LLM | Sonnet 4.6 (memorias) | 1500 calls | $0.005/call | ~$7.5 |
| Query Rewriting | Haiku (expansión) | 1500 calls | $0.0003/call | ~$0.45 |
| Perfil generación | Sonnet 4.6 (perfiles) | 30 calls | $0.01/call | ~$0.30 |
| Reranking | Cohere Rerank (si aplica) | 500 calls | $0.002/call | ~$1 |
| Neo4j + MinIO | Hosting (ya existente) | 1 | $0 (ya pagado) | $0 |
| | | | **TOTAL ESTIMADO** | **~$20/mes** |

---

## 12. Métricas de Éxito

### 12.1 KPIs por Fase

| Fase | Métrica | Target | Cómo medir |
|---|---|---|---|
| F1: Relaciones | % de memorias con al menos 1 relación | >60% | Query Neo4j |
| F1: Relaciones | Contradicciones no resueltas | 0 | MATCH (m:Memory {isLatest:true})-[:UPDATES]->(n:Memory {isLatest:true}) |
| F2: Olvido | Memorias expiradas no limpiadas | 0 (tras cron) | MATCH (m:Memory) WHERE m.validTo < datetime() AND m.forgottenAt IS NULL |
| F3: Ingesta | Documentos procesados/día | >10 | MATCH (d:Document {status:'done'}) WHERE d.createdAt > date() - duration('P1D') |
| F3: Ingesta | Tiempo medio de procesamiento | <60s para texto, <5min para PDF | Diferencia entre createdAt y updatedAt |
| F4: SuperRAG | Relevancia de resultados (manual) | >80% relevantes en top-5 | Evaluación manual semanal |
| F5: Profiles | Precisión del perfil | >90% hechos correctos | Revisión manual mensual |

### 12.2 Comparativa con Supermemory

| Capacidad | Supermemory | Memento v2 Target |
|---|---|---|
| Relaciones automáticas | Updates/Extends/Derives automáticas | Equivalente via LLM pipeline |
| Olvido automático | Time-based + contradiction resolution | Equivalente via cron + decay |
| Ingesta multimodal | PDF, imagen, video, URL, conversación | Equivalente via extractors |
| RAG avanzado | Hybrid search + rerank + query rewrite | Equivalente via Neo4j + Cohere |
| User Profiles | Auto-generated static + dynamic | Equivalente via LLM + cron |
| Conectores | GDrive, Notion, OneDrive, Gmail, GitHub | GDrive + Web Crawler (priorizados) |
| Control del grafo | Caja negra | **VENTAJA: Transparencia total** |
| Soberanía de datos | SaaS (datos en su cloud) | **VENTAJA: Self-hosted** |
| Validación de calidad | No mencionado | **VENTAJA: Protocolo v3.0 con 8 filtros** |
| Coste | SaaS pricing | **VENTAJA: ~$20/mes** |

---

*Fin del documento*
