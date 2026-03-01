import pytest
from app.db.utils import sanitize_identifier


@pytest.mark.parametrize("valid", [
    "entity_embeddings",
    "Entity",
    "my_index",
    "_private",
    "abc123",
    "A",
    "_",
])
def test_sanitize_identifier_accepts_valid_identifiers(valid):
    assert sanitize_identifier(valid) == valid


@pytest.mark.parametrize("invalid", [
    "",
    "123starts_with_digit",
    "has space",
    "has-hyphen",
    "has'quote",
    'has"doublequote',
    "has;semicolon",
    "has(paren",
    "has)paren",
    "drop table",
    "'; DROP INDEX",
    "\x00null",
])
def test_sanitize_identifier_rejects_invalid_identifiers(invalid):
    with pytest.raises(ValueError):
        sanitize_identifier(invalid)


def test_sanitize_identifier_rejects_non_string():
    with pytest.raises(ValueError):
        sanitize_identifier(123)  # type: ignore[arg-type]


def test_sanitize_identifier_returns_string():
    result = sanitize_identifier("valid_name")
    assert isinstance(result, str)
