# Claude Code Instructions

`AGENTS.md` is the canonical project instruction file. Read and follow it before
planning, editing, testing or delivering changes; do not create a separate
workflow or override its risk gates.

In particular: work from a clean task branch against the integration branch, read
`docs/STATE.md` and the open GitHub Issues before planning, keep client data and
credentials out of code and prompts, use verification proportional to risk, and
never deploy, promote a release branch, run migrations or modify real production
data without explicit authorization for that action.
