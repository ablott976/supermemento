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

## MEM-05: fechas de vigencia como días de negocio (Europe/Madrid)

`[V]` 2026-09-11. Mismo criterio que la corrección de zona horaria de PMM Tasks.

El backend y Neo4j corren en UTC. Hasta ahora una fecha sin hora
(`validTo: "2026-09-11"`) se normalizaba a `2026-09-11T00:00:00Z` y la
vigencia se decide con `m.validTo >= datetime()`, así que una memoria que
«caduca el 11/09» dejaba de estar vigente a las 02:00 de Madrid de ese día
(01:00 en invierno): durante casi todo su último día de vigencia se
consideraba caducada. Es el mismo fallo que el de PMM Tasks, con signo
contrario.

Regla desde el 2026-09-11 (`src/services/business-time.ts`, único sitio donde
se declara la zona; `BUSINESS_TIMEZONE`, por defecto `Europe/Madrid`):

| Valor | Interpretación | Ejemplo (verano, CEST) |
|---|---|---|
| `validFrom: "YYYY-MM-DD"` | inicio de ese día en Madrid, 00:00:00 local | `2026-09-11` → `2026-09-10T22:00:00.000Z` |
| `validTo: "YYYY-MM-DD"` | fin de ese día en Madrid, 23:59:59.999 local | `2026-09-11` → `2026-09-11T21:59:59.999Z` |
| ISO datetime completo | sin cambios | `2026-09-11T08:00:00Z` |

Se aplica en todas las entradas: `create_memory`, `batch_create_memories`,
`update_memory`, el `validTo` de documento en `ingest_*` y `crawl_*`
(`metadata.valid_to` queda ya normalizado) y las fechas que propone el
extractor LLM para cada memoria (`pipeline.applyMemoryPolicy`), que antes
llegaban a Neo4j sin pasar por ninguna normalización. La comparación en
Cypher (`m.validTo >= datetime()`) no cambia: compara instantes.

Las memorias guardadas antes de esta fecha llevan el `validTo` (y a menudo el
`validFrom`) a medianoche UTC: el extractor y las tools solo producían fechas
sin hora, así que ese instante significa «ese día». Se normalizan con el
comando reversible `normalize-validity-dates` (ver «Limpieza del histórico»):
`validFrom` al inicio y `validTo` al fin del día en Madrid; cualquier valor
que no esté exactamente a las 00:00:00Z se conserva.

Pruebas (`src/services/business-time.test.ts`, `server.test.ts`,
`pipeline.test.ts`): verano e invierno, ambos cambios de hora de 2026,
paso sin cambios de instantes completos, y la comprobación de que una memoria
que caduca hoy sigue vigente a las 00:36 de Madrid y caduca a las 00:00 del
día siguiente.

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
| `normalize-validity-dates <runId>` | Informe (sin escribir) de las memorias con `validFrom` o `validTo` a las 00:00:00Z exactas y aún sin normalizar: recuento y muestra de antes/después (MEM-05) |
| `normalize-validity-dates <runId> --apply` | Reescribe esas fechas como día de negocio en Madrid (`validFrom` 00:00 local, `validTo` 23:59:59.999 local) guardando en el nodo `validityRunId`, `validityNormalizedAt`, `validityLegacyValidFrom` y `validityLegacyValidTo`. Lotes de 500; una memoria ya marcada no se vuelve a tocar |
| `restore-validity-dates <runId>` | Restaura los valores previos de ese run y elimina las marcas |

Después del despliegue hay que ejecutar `setup_schema` (o `npm run
setup:schema`) para crear los índices `memory_container_content_hash` y
`memory_dedup_run`; sin ellos la búsqueda por hash funciona pero sin índice.

## Configuración

| Variable | Por defecto | Uso |
|---|---|---|
| `DEDUP_SEMANTIC_THRESHOLD` | `0.95` | Similitud coseno mínima para avisar de `possibleDuplicates` |
| `DEDUP_SEMANTIC_LIMIT` | `3` | Máximo de candidatos en el aviso |

`BUSINESS_TIMEZONE` (por defecto `Europe/Madrid`): zona IANA en la que se
interpretan las fechas de vigencia sin hora (MEM-05).

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

## Despliegue y verificación — 2026-09-10

Commit 0e011a6 (main, #66). Mecanismo, el mismo que en despliegues anteriores
del backend (no hay checkout git en el VPS ni build de EasyPanel para este
servicio):

1. `git archive origin/main` enviado por SSH a `/tmp/supermemento-build-<sha>`
   en el VPS.
2. `docker build --label org.opencontainers.image.revision=<sha> -t
   supermemento:<sha7> .` (y `supermemento-chatgpt:<sha7>` con
   `Dockerfile.chatgpt-gateway`, aunque el gateway no cambió y no se desplegó).
3. `docker service update --no-resolve-image --image supermemento:0e011a6
   n8n_supermemento`: convergió en segundos, arranque limpio, `/health` 200
   desde la red interna. El gateway `n8n_supermemento-chatgpt` sigue en
   `3f5846f`; `/ready` 200.
4. Dentro del contenedor: `node dist/schema/setup-schema.js` (índices
   `memory_container_content_hash` y `memory_dedup_run` creados) y
   `node dist/admin/repair-knowledge.js backfill-content-hashes` → 15 093
   memorias con hash en 31 lotes.
5. `dedupe-history dedupe-2026-09-10` (informe): 160 grupos, 568 duplicados
   (129 grupos en `zkteco-pmm`, 31 en `memento-v1`). Tras validar las reglas
   en producción, `--apply`: 568 memorias retiradas (`isLatest: false`,
   relación `DUPLICATE_OF` a 160 canónicas), 0 grupos restantes. Informe y
   resultado guardados en `~/backups/supermemento/` del VPS. Reversible con
   `node dist/admin/repair-knowledge.js restore-dedupe dedupe-2026-09-10`.

Batería de aceptación ejecutada por JSON-RPC directo al backend (contenedor
`chatgpt-mcp-canary`) y por el conector de Claude (gateway):

- `tools/list`: 24 tools; `temporal_class` en `create_memory`, en los
  elementos de `batch_create_memories` y en las cinco tools de ingesta/crawl.
- `create_memory` con `temporal_class: pricing` y sin `validTo` → error
  `validTo is required when temporal_class is pricing`; con `validTo` →
  `created: true`, memoria `2bf8ae62-c96d-466c-bf76-a74f88e24575` con
  `metadata.temporal_class: "pricing"`.
- Mismo contenido con mayúsculas y puntuación distintas → `created: false`,
  `duplicateOf` igual al id anterior, sin nodo nuevo.
- `batch_create_memories` con dos memorias (una nueva `pipeline` con
  `validTo`, una duplicada) → `count: 1`, `duplicates: [{index: 1,
  duplicateOf: ...}]`; con `roadmap` sin `validTo` → rechazado con el índice.
- `ingest_document` con `temporal_class: pricing` sin `validTo` → rechazado
  antes de crear el documento.
- `semantic_search` (memory, `zkteco-pmm`): cada resultado incluye
  `confidence`, `validFrom`, `validTo`, `isLatest` y `forgottenAt`. «GTC»
  devuelve memorias de GoTimeCloud; «GBC» devuelve memorias de GoBridgeCloud
  (incluida la aclaración del 2026-09-10 de que GTC y GBC son productos
  distintos); «GoBridgeTimeCloud» no devuelve ninguna memoria que use ese
  término, solo memorias de GoTimeCloud y GoBridgeCloud por separado.

Las dos memorias canary creadas en la verificación viven en
`chatgpt-mcp-canary` y no afectan a `zkteco-pmm`.

## Despliegue y verificación — 2026-09-11 (MEM-05)

Commit 3d1275a (main, #68), mismo mecanismo: `git archive origin/main` a
`/tmp/supermemento-build-3d1275a`, `docker build --label
org.opencontainers.image.revision=3d1275a… -t supermemento:3d1275a`,
`docker service update --no-resolve-image --image supermemento:3d1275a
n8n_supermemento` (convergió en segundos, `/health` 200, versión 0.2.0,
arranque limpio). Sin `BUSINESS_TIMEZONE` en el servicio: aplica el valor por
defecto `Europe/Madrid`. El gateway no cambió; `/ready` y `/health` 200.

Normalización del histórico dentro del contenedor:

1. `normalize-validity-dates validity-2026-09-11` (informe, guardado en
   `~/backups/supermemento/validity-2026-09-11-report.json` del VPS): 8 467
   memorias, 8 426 `validFrom` y 1 606 `validTo` a las 00:00:00Z; los
   instantes con hora se conservan en la muestra.
2. `--apply`: 8 467 memorias reescritas (`validityRunId`,
   `validityNormalizedAt`, `validityLegacyValidFrom`, `validityLegacyValidTo`);
   resultado en `validity-2026-09-11-apply.json`. Segunda pasada: 0.
3. Comprobación en Neo4j: 0 `validTo` a medianoche UTC; memorias con `validTo`
   vigente pasan de 1 239 a 1 262 (23 se daban por caducadas antes de tiempo);
   `9999-12-31T00:00:00Z` → `9999-12-31T22:59:59.999Z`. Reversible con
   `restore-validity-dates validity-2026-09-11`.

Aceptación por JSON-RPC directo al backend (contenedor `chatgpt-mcp-canary`):

- `create_memory` con `temporal_class: pricing`, `validFrom: "2026-09-11"` y
  `validTo: "2026-09-11"` → `validFrom: 2026-09-10T22:00:00.000Z`,
  `validTo: 2026-09-11T21:59:59.999Z`; visible en `semantic_search` el mismo
  día (antes habría caducado a las 02:00 de Madrid).
- `update_memory` con `validTo: "2026-09-10"` → `2026-09-10T21:59:59.999Z` y
  la memoria deja de aparecer en `semantic_search`.

La memoria canary `5569cdfa-9eb6-4143-a6e0-6ffd0218e8dd` vive en
`chatgpt-mcp-canary` y no afecta a `zkteco-pmm`.
