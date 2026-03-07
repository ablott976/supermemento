from __future__ import annotations

from pathlib import Path

import pytest

try:
    from app.core.processor import DataProcessor, ProcessingError
except ModuleNotFoundError:
    DataProcessor = None
    ProcessingError = None

pytestmark = pytest.mark.skipif(
    DataProcessor is None or ProcessingError is None,
    reason="app.core.processor module is required"
)


class TestDataProcessor:
    """Test suite for DataProcessor."""

    @pytest.fixture
    def temp_input_file(self, tmp_path: Path) -> Path:
        """Create a temporary input file."""
        input_file = tmp_path / "input.txt"
        input_file.write_text("test data")
        return input_file

    @pytest.fixture
    def processor(self, temp_input_file: Path) -> DataProcessor:
        """Create a processor with temp file."""
        return DataProcessor(input_path=temp_input_file)

    def test_validate_input_success(self, processor: DataProcessor) -> None:
        """Test input validation with valid file."""
        assert processor.validate_input() is True

    def test_validate_input_missing_file(self, tmp_path: Path) -> None:
        """Test validation raises error for missing file."""
        missing = tmp_path / "missing.txt"
        processor = DataProcessor(input_path=missing)
        with pytest.raises(ProcessingError, match="not found"):
            processor.validate_input()

    def test_validate_input_directory(self, tmp_path: Path) -> None:
        """Test validation raises error for directory."""
        processor = DataProcessor(input_path=tmp_path)
        with pytest.raises(ProcessingError, match="not a file"):
            processor.validate_input()

    def test_process_success(self, processor: DataProcessor) -> None:
        """Test successful processing."""
        results = processor.process()
        assert isinstance(results, list)
        assert len(results) > 0

    def test_save_results_no_output_path(self, processor: DataProcessor) -> None:
        """Test save raises error when output not set."""
        processor.process()
        with pytest.raises(ProcessingError, match="Output path not set"):
            processor.save_results()

    def test_save_results_success(self, temp_input_file: Path, tmp_path: Path) -> None:
        """Test successful save."""
        output = tmp_path / "output.txt"
        processor = DataProcessor(input_path=temp_input_file, output_path=output)
        processor.process()
        result_path = processor.save_results()
        assert result_path == output
        assert output.exists()
