# Supermemento para ChatGPT

Entrada MCP autenticada y separada para usar Supermemento desde un Proyecto de ChatGPT. No sustituye ni modifica `supermemento-api`.

## Arquitectura

```text
ChatGPT -> HTTPS + OAuth -> gateway -> http://n8n_supermemento:80/mcp
supermemento-api ------------------> http://n8n_supermemento:80/mcp
```

- URL MCP: `https://n8n-supermemento-chatgpt.9kpuqs.easypanel.host/mcp`
- Callback GitHub: `https://n8n-supermemento-chatgpt.9kpuqs.easypanel.host/auth/callback`
- Liveness: `/health`
- Readiness: `/ready`

## Seguridad

- OAuth 2.1 con authorization code, PKCE y consentimiento.
- GitHub solo verifica identidad; no se solicitan permisos sobre repositorios.
- Solo acceden los logins incluidos en `ALLOWED_GITHUB_USERS`.
- Estado OAuth persistente en Redis y cifrado antes de almacenarse.
- Herramientas ocultas por defecto. Se expone una allowlist de lectura y escritura no destructiva.
- `ingest_url`, `ingest_document` y `crawl_*` quedan fuera del canario hasta corregir la validación SSRF del crawler común o añadir una tool de texto forzada.
- `setup_schema`, mantenimiento, delete, forget y update no se publican.
- Rate limit global, respuestas limitadas y errores internos ocultos.
- La imagen corre sin root y las dependencias están fijadas con hashes.

## GitHub OAuth App

GitHub obliga a crearla desde la interfaz:

1. Abrir `https://github.com/settings/developers`.
2. Crear una **OAuth App** llamada `Supermemento ChatGPT`.
3. Homepage: `https://n8n-supermemento-chatgpt.9kpuqs.easypanel.host`.
4. Callback: `https://n8n-supermemento-chatgpt.9kpuqs.easypanel.host/auth/callback`.
5. Guardar el Client ID y el Client Secret en el gestor de secretos del despliegue. No incluirlos en Git, tickets o chats.

## Configuración del gateway

Variables no secretas:

```dotenv
PUBLIC_BASE_URL=https://n8n-supermemento-chatgpt.9kpuqs.easypanel.host
UPSTREAM_MCP_URL=http://n8n_supermemento:80/mcp
UPSTREAM_ALLOWED_HOSTS=n8n_supermemento,n8n-supermemento,supermemento
GITHUB_OAUTH_CLIENT_ID=<client-id>
ALLOWED_GITHUB_USERS=ablott976
ALLOWED_CLIENT_REDIRECT_URIS=https://chatgpt.com/connector_platform_oauth_redirect
REDIS_HOST=supermemento-chatgpt-redis
REDIS_PORT=6379
REDIS_DB=0
PORT=8080
```

Secretos, preferentemente montados como archivos:

```dotenv
GITHUB_OAUTH_CLIENT_SECRET_FILE=/run/secrets/supermemento_chatgpt_github_secret
MCP_GATEWAY_JWT_SIGNING_KEY_FILE=/run/secrets/supermemento_chatgpt_jwt_key
MCP_GATEWAY_STORAGE_ENCRYPTION_KEY_FILE=/run/secrets/supermemento_chatgpt_storage_key
MCP_GATEWAY_REDIS_PASSWORD_FILE=/run/secrets/supermemento_chatgpt_redis_password
```

El código también acepta las variables sin sufijo `_FILE` para plataformas que no montan secretos, pero nunca deben formar parte de la imagen o del repositorio.

Generación local, sin mostrar valores:

```bash
openssl rand -base64 48 > jwt-key
python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())' > storage-key
openssl rand -base64 36 > redis-password
chmod 600 jwt-key storage-key redis-password
```

## Redis

Usar una instancia dedicada, sin dominio ni puerto publicado, unida solo a la red interna del gateway. Activar persistencia AOF y exigir contraseña. No reutilizar Redis de n8n.

## Build y smoke

```bash
docker build -f Dockerfile.chatgpt-gateway -t supermemento-chatgpt:local .
docker inspect supermemento-chatgpt:local --format '{{.Config.User}}'
```

Antes de publicar:

- `/health` devuelve `200`.
- `/ready` devuelve `200` con Redis y upstream disponibles.
- `POST /mcp` sin token devuelve `401` con `WWW-Authenticate`.
- `/.well-known/oauth-protected-resource/mcp` y `/.well-known/oauth-authorization-server` devuelven metadata válida.
- ChatGPT solo descubre las tools de la allowlist.

## Conexión en ChatGPT

1. Activar Developer mode en ChatGPT.
2. Crear una app desde Settings → Plugins.
3. MCP server URL: `https://n8n-supermemento-chatgpt.9kpuqs.easypanel.host/mcp`.
4. Completar la autorización GitHub con `ablott976`.
5. Verificar tools y añadir la app al Proyecto.
6. Ejecutar primero búsquedas de solo lectura; después una creación controlada en un containerTag de canario.

## Compatibilidad y rollback

`supermemento-api` no cambia. El rollback consiste únicamente en retirar el nuevo gateway y su Redis. No se debe modificar ni borrar `n8n_supermemento-api`, su API key, su dominio ni `SUPERMEMENTO_MCP_URL`.
