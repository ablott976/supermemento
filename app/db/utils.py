import re

_IDENTIFIER_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def sanitize_identifier(value: str) -> str:
    """Validate and return a safe Cypher identifier.

    Only alphanumeric characters and underscores are allowed, and the
    identifier must start with a letter or underscore.  Raises
    ``ValueError`` for any input that does not match, preventing
    Cypher-injection when identifiers are interpolated into query strings.
    """
    if not isinstance(value, str) or not _IDENTIFIER_RE.match(value):
        raise ValueError(
            f"Invalid Cypher identifier: {value!r}. "
            "Only letters, digits, and underscores are allowed, "
            "and the identifier must start with a letter or underscore."
        )
    return value
