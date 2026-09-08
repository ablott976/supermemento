# Deployment ownership

Read `/home/ablott/.config/ancora/DEPLOYMENT-OWNERSHIP.md` on Linux first.

Supermemento is shared between Ancora and ZKTeco. Arturo explicitly assigned
Linux as its sole deployment control host on 2026-09-08. Do not infer an
exclusive ZKTeco domain from PMM usage, or start deployment control on Mac.

The contract is [docs/DEPLOYMENT_CONTROL.json](docs/DEPLOYMENT_CONTROL.json).
Current operational evidence and limits are in [docs/STATE.md](docs/STATE.md).
Deployment is manual and requires explicit authorization; this assignment
does not authorize scheduled deployments, additional controllers, credential
transfers, or changes to the runtime host.
