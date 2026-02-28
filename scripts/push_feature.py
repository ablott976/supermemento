#!/usr/bin/env python3
"""Push current changes to feature/40 branch."""

import subprocess
import sys


def push_to_feature_branch() -> int:
    """Push current HEAD to origin/feature/40.
    
    Returns:
        0 on success, 1 on failure
    """
    try:
        result = subprocess.run(
            ["git", "push", "origin", "HEAD:feature/40"],
            capture_output=True,
            text=True,
            check=True
        )
        if result.stdout:
            print(result.stdout)
        if result.stderr:
            print(result.stderr)
        return 0
    except subprocess.CalledProcessError as e:
        print(f"Git push failed: {e.stderr}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(push_to_feature_branch())
