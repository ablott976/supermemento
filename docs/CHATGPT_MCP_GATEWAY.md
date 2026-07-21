# Supermemento para ChatGPT

Entrada MCP autenticada y separada para usar el Supermemento existente desde un Proyecto de ChatGPT. No sustituye ni modifica `supermemento` ni `supermemento-api`.

## Arquitectura

```text
ChatGPT -> HTTPS + OAuth local -> gateway -> http://n8n_supermemento:80/mcp
supermemento-api --------------------------> http://n8n_supermemento:80/mcp
```

- URL MCP: `https://n8n-supermemento-chatgpt.9kpuqs.easypanel.host/mcp`
- Liveness: `/health`
- Readiness: `/ready`
- Estado OAuth persistente: `/data/oauth-store.json`

## OAuth

El gateway incorpora el mismo patrón de autorización del gateway Hermes:

- Dynamic Client Registration para ChatGPT.
- Authorization code + PKCE `S256`.
- Access tokens de una hora y refresh tokens rotatorios.
- Consentimiento inicial mediante un token de propietario.
- El servicio recibe únicamente el SHA-256 del token de propietario.
- El token de propietario solo aprueba OAuth; no se acepta como bearer directo del MCP.
- Client secrets, authorization codes, access tokens y refresh tokens se guardan solo como hashes.
- El estado OAuth persiste en un volumen dedicado; una réplica evita escrituras concurrentes.

No requiere GitHub OAuth, Redis ni permisos sobre repositorios.

Generación del token de propietario en un host seguro:

```bash
python3 - <<'PY'
import hashlib, secrets
raw = 'smo_' + secrets.token_urlsafe(32)
print(raw)
print(hashlib.sha256(raw.encode()).hexdigest())
PY
```

- Guardar el valor `smo_...` en un archivo owner-only fuera del contenedor.
- Configurar únicamente el digest SHA-256 como `MCP_GATEWAY_OWNER_TOKEN_SHA256` o mediante `_FILE`.
- Introducir el token bruto una sola vez en la pantalla de consentimiento al conectar ChatGPT.
- No enviarlo por chat, guardarlo en Git ni mostrarlo en logs.

## Seguridad de tools

- Herramientas ocultas por defecto; solo se exponen nueve tools explícitas.
- Lecturas con defaults seguros para `zkteco-pmm`.
- Escrituras no destructivas marcadas correctamente en MCP.
- `ingest_url`, `ingest_document` y `crawl_*` quedan fuera hasta corregir la validación SSRF común.
- `setup_schema`, mantenimiento, delete, forget y update no se publican.
- Rate limit global, respuestas limitadas y errores internos ocultos.
- Imagen non-root, dependencias fijadas con hashes y root filesystem read-only en producción.

## Configuración

```dotenv
PUBLIC_BASE_URL=https://n8n-supermemento-chatgpt.9kpuqs.easypanel.host
UPSTREAM_MCP_URL=http://n8n_supermemento:80/mcp
UPSTREAM_ALLOWED_HOSTS=n8n_supermemento
ALLOWED_CLIENT_REDIRECT_URIS=https://chatgpt.com/connector_platform_oauth_redirect
MCP_GATEWAY_OWNER_TOKEN_SHA256_FILE=/run/secrets/supermemento_chatgpt_owner_token_sha256
MCP_GATEWAY_OAUTH_STORE_PATH=/data/oauth-store.json
PORT=8080
```

El upstream solo acepta HTTP interno con hostname allowlisted. El gateway no necesita claves de Neo4j, OpenAI, Anthropic ni `supermemento-api`.

## Persistencia

Montar un volumen dedicado en `/data`. El fichero OAuth se escribe de forma atómica con permisos restrictivos y no contiene tokens brutos. Un store ilegible o corrupto bloquea el arranque.

## Smoke antes de conectar ChatGPT

- `/health` devuelve `200`.
- `/ready` devuelve `200` con el volumen escribible y upstream disponible.
- `POST /mcp` sin token devuelve `401` con `WWW-Authenticate`.
- `/.well-known/oauth-protected-resource/mcp` anuncia el recurso correcto.
- `/.well-known/oauth-authorization-server` anuncia DCR, authorization, token y PKCE `S256`.
- DCR acepta únicamente el callback oficial configurado.
- ChatGPT descubre exactamente nueve tools.

## Conexión en ChatGPT

1. Activar Developer mode.
2. Crear la app `Supermemento` con URL `https://n8n-supermemento-chatgpt.9kpuqs.easypanel.host/mcp`.
3. ChatGPT abrirá `Autorizar Supermemento`.
4. Introducir el token de propietario bruto desde el canal seguro.
5. Verificar tools y añadir la app al Proyecto.
6. Ejecutar primero búsquedas; después una creación controlada en `chatgpt-mcp-canary`.

## Compatibilidad y rollback

`supermemento` y `supermemento-api` no cambian. El rollback consiste en retirar o escalar a cero solo el gateway nuevo y conservar su volumen temporalmente. No modificar ni borrar `n8n_supermemento`, `n8n_supermemento-api`, su API key, su dominio ni `SUPERMEMENTO_MCP_URL`.
