# MCP client compatibility

The OAuth gateway supports ChatGPT (including its Codex-hosted connector),
Claude hosted clients, and native Codex/Claude Code clients through dynamic
client registration (DCR). The public MCP URL and owner tokens do not change.
The owner token is entered on the gateway consent screen, not sent as an MCP
bearer token or used as an OAuth client ID.

## Callback policy

- Preserve configured exact HTTPS callbacks and ChatGPT's existing legacy
  callback and bounded dynamic callback IDs.
- Allow exactly `https://claude.ai/api/mcp/auth_callback` for hosted Claude.
- Native clients may register HTTP loopback callbacks on `127.0.0.1` or
  `localhost`, with the path `/callback` or `/callback/<bounded-id>`.
  Authorization may change the listener port only; host and path must match.
- Token exchange still requires the exact redirect used during authorization,
  including its selected port, plus the original PKCE verifier.
- Browser origins remain an explicit list: the gateway, ChatGPT, and Claude.
  Originless native/server-side requests remain supported; arbitrary browser
  origins, lookalike hosts, remote HTTP callbacks, and malformed callbacks
  remain rejected.

The consent screen displays the destination and warns about local applications.
This does not establish a client's identity: the owner must only authorize a
connection they initiated. No wildcard domains or generic local callback paths
are accepted. Custom remote Devbox callbacks still require explicit configuration.

## Deployment and verification

Review the PR before manual deployment. Preserve the effective environment,
owner hashes, OAuth store, mounts, and single-writer restart policy. In
Supermemento, the active owner hash may differ from EasyPanel's saved setting;
do not restore a stale value when deploying.

The compatibility tests cover DCR, consent, S256 PKCE, redirect binding, MCP
discovery, refresh after reload, and rejection of unsafe origins/redirects for
each supported client shape. Production checks should preserve existing OAuth
records and distinguish protocol verification from a user completing login in
the actual client application.

Sources:
- [Claude authentication and callback URLs](https://claude.com/docs/connectors/building/authentication)
- [Codex OAuth client registration and callbacks](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)
