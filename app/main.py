"""Main application module."""

import os
from pathlib import Path
import sys


def get_config_path() -> Path:
    """Return the configuration file path."""
    return Path.home() / ".config" / "app" / "config.yaml"


def main(argv: list[str] | None = None) -> int:
    """Run the main application entry point."""
    if argv is None:
        argv = sys.argv[1:]
    try:
        config_path = get_config_path()
        config_path.parent.mkdir(parents=True, exist_ok=True)
        print(f"Loading configuration from {config_path}")
        print(f"Current working directory: {os.getcwd()}")
        return 0
    except Exception:
        return 1


if __name__ == "__main__":
    sys.exit(main())
