"""Core processing module."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


class ProcessingError(Exception):
    """Raised when processing fails."""

    pass


class DataProcessor:
    """Process data files with validation."""

    def __init__(self, input_path: Path, output_path: Path | None = None) -> None:
        """Initialize processor.

        Args:
            input_path: Path to input file
            output_path: Optional path for output
        """
        self.input_path = input_path
        self.output_path = output_path
        self._processed: list[dict[str, Any]] = []

    def validate_input(self) -> bool:
        """Check if input file exists and is readable.

        Returns:
            True if valid

        Raises:
            ProcessingError: If input is invalid
        """
        if not self.input_path.exists():
            raise ProcessingError(f"Input file not found: {self.input_path}")
        if not self.input_path.is_file():
            raise ProcessingError(f"Input path is not a file: {self.input_path}")
        return True

    def process(self) -> list[dict[str, Any]]:
        """Process the input data.

        Returns:
            List of processed records

        Raises:
            ProcessingError: If processing fails
        """
        try:
            self.validate_input()
            # Simulated processing
            data = [{"id": 1, "value": "test"}]
            self._processed = data
            logger.info("Processed %d records", len(data))
            return data
        except Exception as e:
            if isinstance(e, ProcessingError):
                raise
            raise ProcessingError(f"Unexpected error: {e}") from e

    def save_results(self) -> Path:
        """Save processed results.

        Returns:
            Path to output file

        Raises:
            ProcessingError: If no output path set or save fails
        """
        if self.output_path is None:
            raise ProcessingError("Output path not set")

        try:
            self.output_path.write_text(str(self._processed))
            return self.output_path
        except OSError as e:
            raise ProcessingError(f"Failed to save: {e}") from e
