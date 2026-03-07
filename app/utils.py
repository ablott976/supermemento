"""Utility functions for the application."""


def format_message(message: str, prefix: str = "INFO") -> str:
    """Format a message with a given prefix."""
    return f"[{prefix}] {message}"


def parse_arguments(args: list[str]) -> dict[str, str]:
    """Parse command line arguments into a dictionary."""
    result: dict[str, str] = {}
    for arg in args:
        if "=" in arg:
            key, value = arg.split("=", 1)
            result[key] = value
    return result
