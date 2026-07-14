#!/usr/bin/env bash
set -euo pipefail

image="${1:?usage: deploy_codex_bridge.sh <immutable-image-ref>}"
service="n8n_codex-oauth-bridge"
network="easypanel-n8n"
socket_dir="/home/ablott/.local/run/supermemento"

if [[ "$image" == *:latest || ( "$image" != *@sha256:* && "$image" != *:* ) ]]; then
  echo "An immutable image tag or digest is required" >&2
  exit 2
fi

mkdir -p "$socket_dir"
chmod 700 "$socket_dir"

if docker service inspect "$service" >/dev/null 2>&1; then
  docker service update --no-resolve-image --image "$image" --force "$service" >/dev/null
else
  docker service create \
    --name "$service" \
    --network "name=${network},alias=codex-oauth-bridge" \
    --mount "type=bind,src=${socket_dir},dst=/run/codex,readonly" \
    --user 1000:1000 \
    --read-only \
    --cap-drop ALL \
    --security-opt no-new-privileges=true \
    --constraint 'node.role==manager' \
    --limit-memory 128M \
    --restart-condition any \
    --restart-delay 5s \
    --no-resolve-image \
    "$image" >/dev/null
fi

docker service inspect "$service" --format '{{.Spec.Name}} {{.Spec.TaskTemplate.ContainerSpec.Image}}'
