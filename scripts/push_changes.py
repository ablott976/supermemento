"""
Git push automation for feature/36.
Script to push current HEAD to origin/feature/36.
"""
import logging
import subprocess
import sys

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)


def push_to_feature_branch() -> None:
    """
    Push current changes to origin HEAD:feature/36.
    
    Raises:
        SystemExit: If push fails or git is not installed.
    """
    branch_spec = "HEAD:feature/36"
    
    logger.info(f"Pushing changes to {branch_spec}...")
    
    try:
        result = subprocess.run(
            ["git", "push", "origin", branch_spec],
            check=True,
            capture_output=True,
            text=True
        )
        logger.info("Successfully pushed to origin/feature/36")
        if result.stdout:
            logger.info(result.stdout.strip())
    except subprocess.CalledProcessError as e:
        logger.error(f"Git push failed with exit code {e.returncode}")
        if e.stderr:
            logger.error(e.stderr.strip())
        sys.exit(1)
    except FileNotFoundError:
        logger.error("Git executable not found. Ensure git is installed and in PATH.")
        sys.exit(1)


if __name__ == "__main__":
    push_to_feature_branch()
