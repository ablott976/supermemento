"""Example module demonstrating proper code formatting.

This module follows PEP 8 standards and ruff formatting rules.
"""

import os
import sys
from pathlib import Path
from typing import NoReturn

from pydantic import BaseModel


class Config(BaseModel):
    """Application configuration."""

    api_key: str
    timeout: int = 30


def get_project_root() -> Path:
    """Return the project root directory."""
    return Path(__file__).resolve().parent.parent


def initialize_app(config: Config) -> None:
    """Initialize the application with the given configuration."""
    if not config.api_key:
        raise ValueError("API key is required")

    # Setup logging and other initialization
    print(f"Initializing with timeout: {config.timeout}")


def main() -> NoReturn:
    """Run the main application entry point."""
    try:
        config = Config(api_key=os.getenv("API_KEY", ""))
        initialize_app(config)
        sys.exit(0)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
