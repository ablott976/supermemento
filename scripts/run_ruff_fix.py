#!/usr/bin/env python3
"""Script to run ruff check . --fix as per subtask requirements."""

import subprocess
import sys
from pathlib import Path


def run_ruff_fix() -> int:
    """Execute ruff check . --fix and return exit code.

    Returns:
        int: Exit code from ruff command (0 if no errors, 1 if errors remain)
    """
    # Ensure we're running from the project root
    project_root = Path(__file__).parent.parent
    try:
        result = subprocess.run(
            ["ruff", "check", ".", "--fix"],
            cwd=project_root,
            capture_output=True,
            text=True,
            check=False,
        )

        # Output the results
        if result.stdout:
            print(result.stdout, end="")
        if result.stderr:
            print(result.stderr, end="", file=sys.stderr)

        return result.returncode

    except FileNotFoundError:
        print("Error: ruff is not installed or not in PATH", file=sys.stderr)
        return 127
    except Exception as e:
        print(f"Error running ruff: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(run_ruff_fix())
