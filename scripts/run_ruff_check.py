#!/usr/bin/env python3
"""Run ruff check on the codebase."""

import subprocess
import sys
from collections.abc import Sequence
from pathlib import Path


def run_ruff_check(paths: Sequence[str | Path] = (".",)) -> int:
    """Execute ruff check on the specified paths.
    
    Args:
        paths: Sequence of file or directory paths to check.
               Defaults to current directory.
               
    Returns:
        Exit code from ruff (0 = success, non-zero = issues found).
    """
    cmd = ["ruff", "check"] + [str(p) for p in paths]

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            check=False
        )
    except FileNotFoundError:
        print(
            "Error: ruff is not installed. "
            "Install it with: pip install ruff",
            file=sys.stderr
        )
        return 127
    except PermissionError:
        print("Error: Permission denied when running ruff", file=sys.stderr)
        return 126
    except OSError as e:
        print(f"Error: Failed to run ruff: {e}", file=sys.stderr)
        return 1

    if result.stdout:
        print(result.stdout, end="")
    if result.stderr:
        print(result.stderr, end="", file=sys.stderr)

    return result.returncode


def main() -> int:
    """Run ruff check on the current directory."""
    return run_ruff_check()


if __name__ == "__main__":
    sys.exit(main())
