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
| createdAt | DateTime | Fecha de creación
