"""Narrow callback rules for hosted Claude and native OAuth clients."""

import re

CLAUDE_REDIRECT = "https://claude.ai/api/mcp/auth_callback"
_LOOPBACK = re.compile(
    r"http://(127\.0\.0\.1|localhost)(?::([0-9]{1,5}))?"
    r"(/callback(?:/[A-Za-z0-9_-]{1,256})?)"
)


def loopback_redirect_key(uri: str) -> tuple[str, str] | None:
    """Ignore only the listener port, never the host or callback path."""
    match = _LOOPBACK.fullmatch(uri)
    if match is None:
        return None
    host, port, path = match.groups()
    if port is not None and not 1 <= int(port) <= 65535:
        return None
    return host, path


def registered_redirect_matches(uri: str, registered: str) -> bool:
    if uri == registered:
        return True
    key = loopback_redirect_key(uri)
    return key is not None and key == loopback_redirect_key(registered)
