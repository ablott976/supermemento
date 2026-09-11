# Estado del proyecto

Documento de contexto para quien continúe el desarrollo, con independencia de la
herramienta o la máquina. Si algo relevante para operar el sistema sólo vive en
una conversación, un perfil de agente o la cabeza de alguien, su sitio es este
fichero.

**Regla de mantenimiento.** Todo PR que cambie el estado de producción, abra o
cierre un incidente, o tome una decisión duradera actualiza este documento en el
mismo PR. **El trabajo pendiente son GitHub Issues** (`gh issue list --state open`);
aquí sólo va el estado. El detalle de cada rollout verificado va en
[`MEMORY_POLICY.md`](MEMORY_POLICY.md) («Despliegue y verificación»), no aquí.

**Cómo leerlo.** Cada afirmación lleva su nivel de evidencia:

| Marca | Significado |
|---|---|
| `[V]` | Verificado leyendo el repositorio o el runtime en la fecha indicada |
| `[I]` | Inferido de nombres, rutas o configuración; plausible, no comprobado |
| `[?]` | Desconocido; requiere comprobación en una máquina concreta |

Última revisión completa: 2026-09-12 (lectura del repositorio y de GitHub, y
lectura de solo lectura de los servicios del VPS ejecutada desde el Linux).

---

## 1. Ramas y canal de despliegue

| Rama | Papel | SHA en la revisión |
|---|---|---|
| `main` | Integración, rama por defecto y origen de cada imagen (`git archive origin/main`) | `f2b5ced` `[V]` 2026-09-12 |

- `[V]` 2026-09-11 Rama por defecto en GitHub: `main`. **Sin protección de rama**
  (`GET /branches/main/protection` → 404).
- `[V]` 2026-09-11 `allow_auto_merge` y `delete_branch_on_merge` activados por
  `convenciones.sh --apply` en esta revisión (antes: ambos desactivados).
- `[V]` **No hay CI.** La evidencia de cada PR es `npm run typecheck`, `lint`,
  `test` y `build` declarados en el PR; los tests Python del gateway
  necesitan `fastmcp`.
- `[V]` PR abierto #63 (`docs/shared-linux-deployment-control`, Codex,
  2026-09-08): propone `AGENTS.md`, `STATE.md` y un `DEPLOYMENT_CONTROL.json`
  con `domain: shared`, que el validador de la convención no acepta. Su
  contenido operativo está recogido aquí (§4 y §5); ver pregunta abierta 3.

## 2. Qué hay desplegado

| Objetivo | Dónde | Qué corre | Evidencia |
|---|---|---|---|
| Backend `n8n_supermemento` | VPS, Swarm/EasyPanel, puerto 80 interno | Imagen `supermemento:3d1275a` (commit `3d1275a`, #68), versión 0.2.0; sin `BUSINESS_TIMEZONE` en el servicio (por defecto `Europe/Madrid`) | `[V]` rollout 2026-09-11 en `MEMORY_POLICY.md` |
| Gateway `n8n_supermemento-chatgpt` | VPS, `https://n8n-supermemento-chatgpt.9kpuqs.easypanel.host` | `chatgpt_gateway/` en `3f5846f` (#65); OAuth con volumen de datos propio; owner token sólo como SHA-256 en el entorno | `[V]` rollout 2026-09-10; rotación de token 2026-09-08 (#63) |
| Neo4j | `n8n_neo4j`, bolt interno | Grafo con índices vectoriales; índices `memory_container_content_hash` y `memory_dedup_run` creados el 2026-09-10 | `[V]` rollout 2026-09-10 |
| Copia del código en el VPS | `/etc/easypanel/projects/n8n/supermemento/code` | Copia **sin `.git`**; no es la fuente de las imágenes | `[V]` `MEMORY_POLICY.md` |
| Datos | 15 093 memorias con hash (2026-09-10); 568 duplicados retirados (`dedupe-2026-09-10`); 8 467 memorias con vigencias normalizadas (`validity-2026-09-11`) | Ambas operaciones reversibles con `restore-*` | `[V]` `MEMORY_POLICY.md` |
| Relay OAuth de Codex | Servicio Swarm `n8n_codex-oauth-bridge` en el VPS (imagen `supermemento-codex-bridge:76b10a9`, 2026-07-31) | **`0/1`, en bucle de reinicio** (exit 137, healthcheck): incidente 1 | `[V]` 2026-09-12 desde el Linux |

`[V]` 2026-09-12 Comprobado desde el Linux (`docker service inspect`): backend en
`supermemento:3d1275a` (actualizado 2026-09-11 09:14 UTC) y gateway en
`supermemento-chatgpt:3f5846f`, ambos `1/1`. Coincide con el rollout del
2026-09-11.

## 3. Incidentes abiertos

1. **`n8n_codex-oauth-bridge` en bucle de reinicio** — Issue #71 (2026-09-12).
   `[V]` Réplicas `0/1`, cada tarea muere a los segundos con `exit 137:
   unhealthy container`; el proceso llega a `Private TCP bridge ready`.
   Pendiente decidir si el relay sigue haciendo falta tras la retirada de
   Hermes (retirarlo) o corregir su healthcheck.

Los Issues abiertos #1–#29 son hallazgos de auditoría (`[PERF]`, `[DX]`,
`[ROUTES]`) de 2026-02, sin incidente de runtime asociado.

## 4. Cómo se despliega

La asignación vive en [`DEPLOYMENT_CONTROL.json`](DEPLOYMENT_CONTROL.json):
**ZKTeco → control de despliegue en Linux** (Arturo, 2026-09-11; antes, el
2026-09-08, lo había declarado compartido con Linux como único host de
control), `mechanism=manual`, `status=verified`.

- `[V]` Mecanismo del backend (rollouts 2026-09-10 y 2026-09-11): `git archive
  origin/main` enviado por SSH a `/tmp/supermemento-build-<sha>` en el VPS;
  `docker build --label org.opencontainers.image.revision=<sha> -t
  supermemento:<sha7> .`; `docker service update --no-resolve-image --image
  supermemento:<sha7> n8n_supermemento`. Sin checkout git ni build de
  EasyPanel para el backend. El gateway se construye con
  `Dockerfile.chatgpt-gateway` y sólo se despliega si cambió `chatgpt_gateway/`.
- `[V]` Verificación de cada rollout: convergencia del servicio, arranque
  limpio, `/health` 200 desde la red interna, gateway `/ready` y `/health`
  200, `/mcp` sin autenticación rechazado, JSON-RPC directo a
  `http://127.0.0.1:80/mcp` desde dentro del contenedor.
- `[V]` Operaciones de datos tras el rollout: `node dist/schema/setup-schema.js`
  y `node dist/admin/repair-knowledge.js <comando> <runId>` primero como
  informe y después `--apply`; informes en `~/backups/supermemento/` del VPS;
  cada run conserva su `restore-*`.
- `[V]` Rotación del owner token del gateway (2026-09-08, #63): actualizar
  sólo `MCP_GATEWAY_OWNER_TOKEN_SHA256` en el servicio conservando el volumen
  OAuth y el resto del entorno; comprobar el digest efectivo sin mostrarlo,
  `/health` público y rechazo de `/mcp` sin autenticación; no revocar
  clientes. La sincronización del estado deseado de EasyPanel **no** queda
  verificada por un `service update`: antes de un futuro despliegue desde
  EasyPanel, comprobar que su valor del token coincide con el aprobado.
- `[V]` **Desde qué máquina.** #63 registra un rollout verificado desde Linux
  (`ablott`, `ssh vps`) el 2026-09-07 (revisión `2e649ec`). Los rollouts del
  2026-09-10 y 2026-09-11 se ejecutaron **desde el Mac** con el mismo
  mecanismo. `[V]` 2026-09-12 Comprobado desde el Linux que la ruta sigue
  operativa tras la retirada de Hermes: `ssh vps` con la clave
  `linux_to_fleet`, `docker service ls/inspect` sobre los tres servicios,
  clon `~/supermemento` presente (en una rama de feature; para desplegar se
  usa `git archive origin/main`, no el clon). No hay CLI de EasyPanel en el
  Linux ni en el VPS, y este mecanismo no lo necesita. Con ello el contrato
  pasa a `verified`.
- `[V]` Sin reconciliador, sin ledger, sin despliegues programados.

## 5. Riesgos y limitaciones conocidas

- `[V]` 2026-09-11 `main` sin protección y sin CI: la única verificación es la
  que cada PR declare.
- `[V]` 2026-09-11 Control asignado a Linux pero rollouts recientes desde el
  Mac; sin comprobar que la ruta desde Linux siga operativa tras la retirada
  de Hermes.
- `[V]` 2026-09-11 El estado deseado de EasyPanel puede divergir del servicio
  real (imagen y token actualizados por `docker service update`): un
  redespliegue desde la UI de EasyPanel podría restaurar una imagen o un
  token antiguos.
- `[V]` La copia de código en `/etc/easypanel/projects/n8n/supermemento/code`
  no tiene `.git` y no es la fuente de nada; no editarla ni deducir de ella
  qué corre.
- `[V]` Las reparaciones de histórico (`dedupe`, `normalize-validity-dates`)
  son mutaciones masivas sobre producción: siempre informe, revisión y
  `--apply` autorizado, nunca desde un test.
- `[V]` 2026-09-11 `README.md` cita «n8n Workflows» como orquestación; n8n ya
  no existe en el VPS. Corregirlo es un Issue aparte.
- `[?]` Vigencia del relay OAuth de Codex (`deploy/`): sin comprobar dónde
  corre ni si sigue en uso.

## 6. Decisiones tomadas

| Fecha | Decisión |
|---|---|
| 2026-09-07 | Convención de dominios: PMM y sus herramientas son ZKTeco → Linux (`DEPLOYMENT-OWNERSHIP.md`); Supermemento quedó pendiente de confirmar. |
| 2026-09-08 | Arturo declara Supermemento compartido Áncora/ZKTeco con Linux como único host de control (#63). |
| 2026-09-10 | Política de memorias MEM-01…MEM-04: `temporal_class` con `validTo` obligatorio, dedup exacta por `contentHash`, proyección temporal en `semantic_search` (#66); histórico deduplicado (`dedupe-2026-09-10`). |
| 2026-09-11 | MEM-05: `validFrom`/`validTo` sin hora son días de negocio Europe/Madrid (#68); histórico normalizado (`validity-2026-09-11`). |
| 2026-09-11 | Arturo confirma dominio **ZKTeco** (control Linux). Adopción de las convenciones de repositorio: `AGENTS.md`, `CLAUDE.md`, este documento y `DEPLOYMENT_CONTROL.json` con el esquema del validador. |
| 2026-09-12 | Contrato a `status=verified`: ruta Linux → VPS comprobada y runtime coincidente con el rollout del 2026-09-11. |

## 7. Preguntas abiertas

| # | Pregunta | Cómo se resuelve | Bloquea |
|---|---|---|---|
| 1 | ~~¿Qué control existe hoy en Linux?~~ Resuelta el 2026-09-12: `ssh vps` + `docker` operativos desde el Linux (§4), `status=verified`. Queda: que el próximo rollout se ejecute desde el Linux y se anote en `MEMORY_POLICY.md`. | — | — |
| 2 | ¿Se protege `main` (y con qué checks, si algún día hay CI)? | Decisión de Arturo; `gh api -X PUT .../branches/main/protection`. | Nada hoy |
| 3 | ¿Qué se hace con el PR #63 (`domain: shared`, esquema no validable)? | Cerrarlo como sustituido por este PR, o fusionarlo primero y reconciliar aquí; decisión de Arturo. | Un solo contrato en `main` |
| 4 | ~~¿Sigue activo el relay OAuth de Codex?~~ Resuelta el 2026-09-12: es `n8n_codex-oauth-bridge` en el VPS y está en bucle de reinicio (incidente 1, #71). Queda decidir si se retira o se corrige. | Decisión de Arturo en #71. | Nada hoy; ruido en Swarm |

## 8. Documentos relacionados

| Documento | Contenido |
|---|---|
| [`AGENTS.md`](../AGENTS.md) | Contrato de trabajo canónico |
| [`DEPLOYMENT_CONTROL.json`](DEPLOYMENT_CONTROL.json) | Contrato de propiedad del despliegue |
| [`MEMORY_POLICY.md`](MEMORY_POLICY.md) | Reglas de memorias MEM-01…MEM-05, contrato por tool, reparaciones reversibles y registro de rollouts verificados |
| [`CHATGPT_MCP_GATEWAY.md`](CHATGPT_MCP_GATEWAY.md), [`MCP_CLIENT_COMPATIBILITY.md`](MCP_CLIENT_COMPATIBILITY.md) | Gateway para ChatGPT y compatibilidad de clientes |
| [`OPENAI_CODEX_OAUTH.md`](OPENAI_CODEX_OAUTH.md), [`OPENAI_CODEX_SUBSCRIPTION.md`](OPENAI_CODEX_SUBSCRIPTION.md), [`../deploy/`](../deploy/) | Relay OAuth de Codex y sus units |
| [`SPEC.md`](SPEC.md) | Especificación de desarrollo |
| [`../README.md`](../README.md) | Arquitectura y conceptos |
| **GitHub Issues** | El backlog vivo. `gh issue list --state open` |
