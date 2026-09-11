# Supermemento — Project Instructions

Self-hosted memory infrastructure for AI agents: an MCP server over Neo4j
(Node/TypeScript, `src/`) plus the Python ChatGPT gateway (`chatgpt_gateway/`,
OAuth, 18 tools) that exposes it to ChatGPT Work. Used as the project-context
store for ZKTeco PMM (`containerTag zkteco-pmm`) and other containers.
**ZKTeco domain** (Arturo, 2026-09-11).

## Where the state lives

Read these before planning or asking. They answer "what is in production, who
deploys it, and what is unfinished" without needing a conversation.

- [`docs/STATE.md`](docs/STATE.md) — current state: branches and deploy channel,
  what is deployed, open incidents, how deployment happens and from which
  machine, known risks and limitations, decisions taken with their date, open
  questions. Every PR that changes production state, opens or closes an
  incident, or takes a durable decision updates it in the same PR.
- [`docs/DEPLOYMENT_CONTROL.json`](docs/DEPLOYMENT_CONTROL.json) — deployment
  ownership contract (domain, control host, mechanism, status).
- [`docs/MEMORY_POLICY.md`](docs/MEMORY_POLICY.md) — the memory rules in force
  (MEM-01…MEM-05: `temporal_class`, `validTo`, deduplication, ingestion,
  business-day validity), the per-tool contract, the reversible history
  repairs, **and the log of every verified rollout** ("Despliegue y
  verificación — <fecha>"). A rollout not written there did not happen.
- [`docs/CHATGPT_MCP_GATEWAY.md`](docs/CHATGPT_MCP_GATEWAY.md),
  [`docs/MCP_CLIENT_COMPATIBILITY.md`](docs/MCP_CLIENT_COMPATIBILITY.md) — the
  gateway, its OAuth flow and client compatibility.
  [`docs/OPENAI_CODEX_OAUTH.md`](docs/OPENAI_CODEX_OAUTH.md),
  [`docs/OPENAI_CODEX_SUBSCRIPTION.md`](docs/OPENAI_CODEX_SUBSCRIPTION.md) and
  `deploy/` — the Codex OAuth relay and its systemd units.
- [`docs/SPEC.md`](docs/SPEC.md) — the development specification;
  [`README.md`](README.md) — architecture and core concepts (its "n8n
  Workflows" line is historical: n8n no longer exists on the VPS).

## Work tracking

**GitHub Issues is the only backlog.** Any work item that outlives the current
session belongs there — not in a conversation, an agent profile, a scratch file,
a plan document or a TODO comment. If it is not an Issue, it does not exist and
nobody will find it.

Read the open work before planning, and say which Issue you are acting on:

```sh
gh issue list --state open --limit 50
gh issue view <n> --comments
```

When you find real work that is outside the scope of the current change, **open
an Issue instead of widening the change**, then keep going:

```sh
gh issue create --title "…" --body "…"
```

Rules that keep the trail readable:

- The title states the problem or the outcome, not the fix you have in mind.
- The body carries enough context to act without this session: file paths,
  affected deployments, the evidence you saw, and how to verify it is done.
- Reference the Issue from the PR that closes it (`Closes #123`).
- A finding you decide not to act on is still an Issue. Silent triage is how a
  backlog becomes unusable.

## Scheduling

Every periodic job is a versioned manifest in this repository, and its systemd
or launchd unit is generated from it. **No agent schedules anything.** A job
that only exists inside a tool disappears with the tool. The only units this
repository owns are the Codex relay and tunnel services under `deploy/`;
nothing deploys or repairs memories on a schedule.

## Deployment ownership

Read `docs/DEPLOYMENT_CONTROL.json` and `docs/STATE.md` before deployment work.
Ancora control belongs to the Mac mini; ZKTeco control belongs to Linux, including
PMM and LinkedIn projects even when their repository names do not say ZKTeco.
For every new repository, tell Arturo its domain and control host before setting
up deployment. Ask if its business domain is ambiguous; never silently default.
The control host is not the runtime or CI runner. Declare the real mechanism,
entry point, ledger and runtime; `planned` does not mean installed or verified.
Use `mechanism=none` and `status=no-deployment` if no deployment is needed.
Never schedule deployment or run two controllers. A host assignment does not
authorize provisioning, credential copying, a state move or a deployment.
Read-only inspection and development may happen elsewhere; mutations must be
initiated on the designated control host through the project's approved path.

This repository is **ZKTeco → Linux**. The runtime is the VPS: Swarm services
`n8n_supermemento` (backend) and `n8n_supermemento-chatgpt` (gateway), with
Neo4j in `n8n_neo4j`. There is **no git checkout and no EasyPanel build** for
the backend: deployment is `git archive` over SSH, `docker build` on the VPS
and a targeted `docker service update`, exactly as the rollout log in
`docs/MEMORY_POLICY.md` records. Manual, authorized per rollout, no ledger, no
schedule. The gateway is redeployed only when `chatgpt_gateway/` changed.

## Source of truth and scope

- `main` is the only long-lived branch: integration branch, default branch and
  the source of every image (`git archive origin/main`). Feature branches open
  PRs to `main`.
- The memory rules are `docs/MEMORY_POLICY.md`; a change to a tool contract,
  to `temporal_class`/`validTo` semantics, to deduplication or to validity
  dates is a policy change, documented there in the same PR, and usually
  needs a reversible history repair (`node dist/admin/repair-knowledge.js`)
  with its `runId` recorded.
- Neo4j is the only store; schema and indexes are `src/schema/` and are
  applied with `node dist/schema/setup-schema.js` inside the container.
- The gateway's OAuth store, owner token (stored only as its SHA-256 in the
  service environment) and API keys live in the service environment and the
  OAuth data volume; never in the repo, in docs or in a log.
- `containerTag` scopes every memory; `zkteco-pmm` is the default scope for
  PMM context. Task management is not this product's job.

## Verification

- There is **no CI workflow**. Before opening a PR run `npm run typecheck`,
  `npm run lint`, `npm test` and `npm run build`, and say so in the PR. The
  gateway's Python tests (`tests/`, `pytest`) need `fastmcp`; if they cannot
  run on the machine, say which ones did not run instead of claiming green.
- Run the focused tests that can fail for the changed behaviour first, then
  the full suite for shared services, the Neo4j client, tool schemas or the
  gateway.
- A rollout is verified only as `docs/MEMORY_POLICY.md` does it: service
  converged on the new image with `org.opencontainers.image.revision`, clean
  start, `/health` 200 from inside the container, gateway `/ready` and
  `/health` 200, unauthenticated `/mcp` rejected, and a JSON-RPC
  `initialize → tools/call` against `http://127.0.0.1:80/mcp` from inside
  the container. Append that evidence to the rollout log in the same task.
- History repairs run first as a report, then with `--apply` only after the
  report is reviewed; every applied run keeps its restore path and its
  reports under `~/backups/supermemento/` on the VPS. Write tests use the
  `chatgpt-mcp-canary` container, never a production container.

## Delivery and safety

- Commit, push and open a PR to `main`; delivery ends at the verified PR. Do
  not deploy, run schema setup, apply a history repair or rotate a token
  without explicit authorization for that action. Do not force-push shared
  branches.
- Never commit secrets: owner token or its digest, OAuth stores, Neo4j
  credentials, OpenAI keys, environment dumps. Documentation shows the shape
  only.
- Keep project state in the repo (`docs/STATE.md`, the rollout log in
  `docs/MEMORY_POLICY.md`) and GitHub Issues, not in conversations or in
  memories of another tool.

## Closeout report

Every task ends with an explicit deployment line, for every repository and tool,
even when the change is documentation or context only. Never leave Arturo to
infer it from "merged", "tests passed" or silence. One line, one status, one
brief reason:

- `Redespliegue: no necesario` — no runtime rollout is required.
- `Redespliegue: necesario, pendiente` — required but not performed; name the
  affected targets (`n8n_supermemento`, `n8n_supermemento-chatgpt`, or both)
  and the missing authorization or actual blocker.
- `Redespliegue: realizado y verificado` — only after rollout acceptance.
- `Redespliegue: pendiente de determinar` — evidence is insufficient; say what
  must be checked instead of guessing that it is unnecessary.

Report queued, in-progress, failed or unverified actions as such, never as
completed. Mention a required schema setup, history repair or token rotation
separately if it is not a redeploy. This rule does not authorize a deployment
and does not waive testing or scope. A merged PR to `main` is
`Redespliegue: necesario, pendiente` until the image is built and the service
updated.
