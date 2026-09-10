# Política de memorias: vigencia, deduplicación y proyección de búsqueda

`[V]` 2026-09-10. Correcciones MEM-01..MEM-04 del prompt «correcciones en los
MCP de PMM Tasks y Supermemento». Las skills y los ficheros de proyecto no se
tocan en esta tanda; este documento es la referencia del contrato real.

## Resumen

| Bloque | Cambio | Dónde |
|---|---|---|
| MEM-01 | `semantic_search` proyecta `confidence`, `validFrom`, `validTo`, `isLatest` y `forgottenAt` en cada resultado `memory` | `src/services/search/search-service.ts` |
| MEM-02 | `temporal_class` declarado por el creador; `pricing`, `roadmap` y `pipeline` exigen `validTo` en el servidor | `src/services/memory-policy.ts`, `src/server.ts` |
| MEM-03 | Duplicado exacto por hash de `containerTag + contenido normalizado`: no se crea y se devuelve `created: false` + `duplicateOf`. Aviso `possibleDuplicates` por similitud, sin fusionar | `src/db/neo4j-client.ts`, `src/server.ts` |
| MEM-04 | Las dos reglas se aplican también en `ingest_document`, `ingest_url`, `ingest_conversation`, `crawl_url` y `crawl_urls` | `src/services/ingestion/pipeline.ts`, `src/services/connectors/web-crawler.ts` |
| Histórico | Backfill de hashes y limpieza reversible de duplicados (`isLatest: false` + `DUPLICATE_OF`), sin borrado físico | `src/admin/repair-knowledge.ts` |

El gateway de ChatGPT (`chatgpt_gateway/`) no cambia: sigue publicando las
mismas 18 tools y reenvía los esquemas del backend, así que los parámetros
nuevos aparecen al refrescar la definición del conector.

## MEM-01: proyección de `semantic_search`

Cada resultado con `type: "memory"` incluye ahora, además de `id`, `type`,
`score`, `content`, `containerTag`, `sourceDocId`, `memoryType`, `metadata` y
`rerankScore`:

| Campo | Tipo | Significado |
|---|---|---|
| `confidence` | number | Fiabilidad actual (tras decaimiento) |
| `validFrom` | ISO datetime \| null | Inicio de vigencia |
| `validTo` | ISO datetime \| null | Fin de vigencia. `null` = permanente |
| `isLatest` | boolean | `false` si otra memoria la sustituye (UPDATES) o fue retirada como duplicada |
| `forgottenAt` | ISO datetime \| null | Fecha de olvido lógico |

Por defecto la búsqueda sigue filtrando `isLatest = true`, `forgottenAt IS
NULL` y `validTo` no pasado; con `includeExpired: true` se devuelven memorias
caducadas y `validTo` permite reconocerlas sin una segunda llamada. Los
resultados `chunk` no llevan estos campos.

## MEM-02: `temporal_class` y `validTo` obligatorio

Nuevo parámetro opcional `temporal_class` con valores `pricing`, `roadmap`,
`pipeline` o `none` (por defecto `none`) en:

- `create_memory`
- `batch_create_memories` (por elemento de `memories[]`)
- `ingest_document`, `ingest_url`, `ingest_conversation`, `crawl_url`,
  `crawl_urls` (a nivel de documento, junto con un `validTo` opcional que
  hereda cada memoria extraída que no traiga el suyo)

Resolución: argumento explícito → `metadata.temporal_class` → `none`. Un valor
fuera del enum se rechaza. Regla del servidor:

```
temporal_class != "none"  =>  validTo obligatorio
```

- `create_memory` y `batch_create_memories`: sin `validTo` la llamada devuelve
  error (`isError: true`, texto `validTo is required when temporal_class is
  pricing`) y no se escribe nada. En el batch se validan todos los elementos
  antes de escribir; el error indica el índice (`memories[3]: ...`).
- Ingesta y crawl: sin `validTo` la llamada se rechaza antes de crear el
  documento. Con `validTo`, se guarda en el documento (`metadata.valid_to`) y
  el pipeline lo aplica a cada memoria extraída sin `validTo` propio. Si aun
  así una memoria queda sin `validTo`, no se crea y se cuenta en
  `memories_rejected`.
- La clase declarada se guarda siempre en `metadata.temporal_class` de la
  memoria (también `none`), de modo que las memorias nuevas son explícitas y
  las históricas sin clave se tratan como `none`.

No se clasifica por palabras clave del contenido.

## MEM-03: deduplicación

### Duplicado exacto

1. Normalización del contenido: Unicode NFKC, minúsculas, cualquier secuencia
   de caracteres que no sea letra o dígito se convierte en un espacio,
   recorte. Se conservan los diacríticos (`año` ≠ `ano`).
2. `contentHash = sha256(containerTag + "\n" + contenido_normalizado)`,
   almacenado en la propiedad `contentHash` del nodo `Memory` (índice
   `memory_container_content_hash`).
3. Antes de crear, se busca una memoria vigente con el mismo hash en el
   contenedor: `isLatest = true`, `forgottenAt IS NULL` y `validTo` nulo o
   futuro. Si existe:

```json
{ "created": false, "duplicateOf": "<memoryId>", "memory": { ... } }
```

y no se consume embedding ni se crea nodo.

`create_memory` responde ahora `{ created: true, memory, relationClassification:
"async", possibleDuplicates? }`. `batch_create_memories` responde `{ count,
memories, duplicates: [{ index, duplicateOf }], message }`; los duplicados
dentro del mismo lote se reducen a uno (gana la primera aparición) y
`duplicateOf` apunta a la memoria creada o a la existente.

### Duplicado semántico

No se fusiona nada automáticamente. `create_memory` añade
`possibleDuplicates: [{ id, score, content }]` cuando alguna memoria vigente
del contenedor supera `DEDUP_SEMANTIC_THRESHOLD` (por defecto 0.95, máximo
`DEDUP_SEMANTIC_LIMIT` = 3 candidatos). Es un aviso para revisión humana; si la
comprobación falla, la memoria se crea igualmente sin el aviso.

## MEM-04: ingesta

`processDocument` aplica la política antes de calcular embeddings:

1. `validTo = memoria.validTo ?? documento.metadata.valid_to`.
2. Si `documento.metadata.temporal_class != none` y no hay `validTo`, la
   memoria se rechaza.
3. Hash; se descartan los duplicados dentro del mismo documento y los que ya
   existan vigentes en el contenedor.

El resultado queda en la metadata del documento (`memories_created`,
`memories_duplicate`, `memories_rejected`) y `get_document_status` lo expone
como objeto. `crawl_url` y `crawl_urls` guardan `temporal_class` y `valid_to`
en cada documento que ingieren; la deduplicación de documentos por
`contentHash` de página que ya existía se mantiene.

## Contrato resultante por tool

| Tool | Parámetros nuevos | Respuesta |
|---|---|---|
| `create_memory` | `temporal_class` (enum, def. `none`) | `created`, `duplicateOf` (si duplicado), `possibleDuplicates` (si hay candidatos), resto sin cambios |
| `batch_create_memories` | `memories[].temporal_class` | `duplicates: [{ index, duplicateOf }]`; `count` y `memories` son solo las creadas |
| `semantic_search` | ninguno | `confidence`, `validFrom`, `validTo`, `isLatest`, `forgottenAt` por resultado `memory` |
| `ingest_document`, `ingest_url`, `ingest_conversation` | `temporal_class`, `validTo` | sin cambios; el documento lleva `temporal_class` y `valid_to` en metadata |
| `crawl_url`, `crawl_urls` | `temporal_class`, `validTo` | sin cambios |
| `list_memories`, `update_memory`, `get_memory_relations` | ninguno | las memorias exponen además `contentHash` |

## Limpieza del histórico (reversible)

Comandos del CLI admin (`node dist/admin/repair-knowledge.js ...`, dentro del
contenedor con las variables de entorno del servicio):

| Comando | Efecto |
|---|---|
| `backfill-content-hashes` | Calcula `contentHash` para las memorias que no lo tienen, en lotes de 500. Idempotente, no cambia nada más |
| `dedupe-history <runId>` | Informe (sin escribir) de los grupos de memorias vigentes que comparten `containerTag` y `contentHash` |
| `dedupe-history <runId> --apply` | Conserva como canónica la más antigua de cada grupo y retira el resto: `isLatest = false`, `dedupRunId`, `dedupCanonicalId`, `dedupRetiredAt` y relación `DUPLICATE_OF` hacia la canónica. No borra nada |
| `restore-dedupe <runId>` | Deshace la retirada de ese run: `isLatest = true`, elimina marcas y relaciones |

Después del despliegue hay que ejecutar `setup_schema` (o `npm run
setup:schema`) para crear los índices `memory_container_content_hash` y
`memory_dedup_run`; sin ellos la búsqueda por hash funciona pero sin índice.

## Configuración

| Variable | Por defecto | Uso |
|---|---|---|
| `DEDUP_SEMANTIC_THRESHOLD` | `0.95` | Similitud coseno mínima para avisar de `possibleDuplicates` |
| `DEDUP_SEMANTIC_LIMIT` | `3` | Máximo de candidatos en el aviso |

## Batería de aceptación

| Comprobación | Dónde |
|---|---|
| `semantic_search` devuelve `confidence`, `validFrom`, `validTo`, `isLatest`, `forgottenAt` | `search-service.test.ts` y producción |
| `create_memory` con `temporal_class: pricing` sin `validTo` → rechazado | `server.test.ts` («Memory policy») |
| `create_memory` con `temporal_class: pricing` y `validTo` → creado con `metadata.temporal_class` | `server.test.ts` |
| duplicado exacto → `created: false` + `duplicateOf` | `server.test.ts`, `neo4j-client.test.ts` |
| `batch_create_memories` con 2 a 50 memorias, con duplicados dentro y fuera del lote | `server.test.ts` |
| la ingesta aplica las dos reglas | `pipeline.test.ts`, `server.test.ts` (ingest y crawl) |
| «GTC» → GoTimeCloud, «GBC» → GoBridgeCloud, sin «GoBridgeTimeCloud» | verificación en producción |
