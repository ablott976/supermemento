#!/usr/bin/env bash
set -euo pipefail

service="${SUPERMEMENTO_SERVICE:-n8n_supermemento}"
secret_name="${CODEX_RELAY_SECRET_NAME:-supermemento_codex_relay_key}"
secret_target="supermemento_codex_relay_key"
base_url="${OPENAI_CODEX_BASE_URL:-http://codex-oauth-bridge:18646/v1}"
model="${OPENAI_CODEX_MODEL:-gpt-5.6-luna}"
health_url="${SUPERMEMENTO_HEALTH_URL:-https://n8n-supermemento.9kpuqs.easypanel.host/health}"

if ! docker service inspect "$service" >/dev/null 2>&1; then
  echo "Supermemento service not found" >&2
  exit 1
fi

if ! docker secret inspect "$secret_name" >/dev/null 2>&1; then
  if [[ -t 0 ]]; then
    echo "Pipe the relay bearer on stdin to create the Swarm secret" >&2
    exit 2
  fi
  docker secret create "$secret_name" - >/dev/null
fi

attached=false
while IFS= read -r attached_name; do
  if [[ "$attached_name" == "$secret_name" ]]; then
    attached=true
    break
  fi
done < <(docker service inspect "$service" --format '{{range .Spec.TaskTemplate.ContainerSpec.Secrets}}{{println .SecretName}}{{end}}')

update=(
  docker service update
  --detach=false
  --env-add "LLM_PROVIDER=openai-codex"
  --env-add "OPENAI_CODEX_MODEL=${model}"
  --env-add "OPENAI_CODEX_BASE_URL=${base_url}"
  --env-add "OPENAI_CODEX_RELAY_KEY_FILE=/run/secrets/${secret_target}"
  --env-add "LLM_REQUEST_TIMEOUT_MS=120000"
  --env-add "LLM_REASONING_EFFORT=low"
)

if [[ "$attached" != true ]]; then
  update+=(--secret-add "source=${secret_name},target=${secret_target},mode=0400")
fi

while IFS= read -r environment_entry; do
  if [[ "$environment_entry" == OPENAI_CODEX_RELAY_KEY=* ]]; then
    update+=(--env-rm OPENAI_CODEX_RELAY_KEY)
    break
  fi
done < <(docker service inspect "$service" --format '{{range .Spec.TaskTemplate.ContainerSpec.Env}}{{println .}}{{end}}')

update+=("$service")
"${update[@]}" >/dev/null

container_id=""
for _ in $(seq 1 60); do
  container_id="$(docker ps --filter "label=com.docker.swarm.service.name=${service}" -q | head -n 1)"
  if [[ -n "$container_id" ]] && docker exec "$container_id" sh -c \
    'test -r /run/secrets/supermemento_codex_relay_key && test "${LLM_PROVIDER:-}" = openai-codex && test -z "${OPENAI_CODEX_RELAY_KEY:-}"'; then
    break
  fi
  container_id=""
  sleep 2
done

if [[ -z "$container_id" ]]; then
  echo "Supermemento did not start with the mounted Codex secret" >&2
  exit 1
fi

status="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$health_url")"
if [[ "$status" != "200" ]]; then
  echo "Supermemento health check failed" >&2
  exit 1
fi

attached_after="$(docker service inspect "$service" --format '{{range .Spec.TaskTemplate.ContainerSpec.Secrets}}{{println .SecretName}}{{end}}')"
if [[ "$attached_after" != *"$secret_name"* ]]; then
  echo "Codex relay secret is not attached to Supermemento" >&2
  exit 1
fi

printf 'service=%s provider=openai-codex secret_mounted=yes health=200\n' "$service"
