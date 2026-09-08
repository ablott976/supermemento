# Deployment control

Arturo confirmed on 2026-09-08 that Supermemento is shared and Linux is its
sole control host. This explicit shared-domain decision does not move runtime
or CI, assign the product exclusively to either domain, or authorize schedules.

## Verified manual path

- Control: `ablott` on Linux, via the existing `ssh vps` connection.
- Runtime: existing VPS Docker Swarm managed by EasyPanel.
- Application: `n8n_supermemento`; ChatGPT gateway: `n8n_supermemento-chatgpt`.
- Entry point: targeted `docker service update`, initiated from Linux only.
- No deployment reconciler or ledger is installed by this assignment.
- Verified application deployment: revision `2e649ec6cdccb1a53ac36e6d27dd11fd825611aa`;
  live create/list/search metadata and batch/update smoke passed on 2026-09-07.
- Gateway owner-token rotation on 2026-09-08 uses only its SHA-256 environment
  setting. Never commit the raw token, digest, OAuth store, or environment dump.

## Manual gateway rotation

With explicit owner authorization, retain the previous service specification
through Swarm rollback, update only `MCP_GATEWAY_OWNER_TOKEN_SHA256`, and wait
for the gateway update to complete. Keep the OAuth data volume and other
environment settings intact. Check the effective digest in the running process
without displaying it, public `/health`, and unauthenticated `/mcp` rejection.
Do not revoke existing clients or move their credentials as part of rotation.

EasyPanel desired-state synchronization is not verified by a Swarm update.
Before a future EasyPanel-driven deployment, ensure its owner-token setting
matches the active approved configuration rather than restoring a stale value.
