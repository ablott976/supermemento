"""Tests for core module."""


from app.core import DataProcessor, process_data


class TestProcessData:
    """Tests for process_data function."""

    def test_process_string(self) -> None:
        """Test processing string."""
        result = process_data("hello")
        assert result == "hello"

    def test_process_int(self) -> None:
        """Test processing integer."""
        result = process_data(42)
        assert result == "42"

    def test_process_none(self) -> None:
        """Test processing None."""
        result = process_data(None)
        assert result == "None"


class TestDataProcessor:
    """Tests for DataProcessor class."""

    def setup_method(self) -> None:
        """Set up test fixture."""
        self.processor = DataProcessor()

    def test_initial_count(self) -> None:
        """Test initial processed count."""
        assert self.processor.processed_count == 0

    def test_process_value(self) -> None:
        """Test processing a value."""
        result = self.processor.process(5)
        assert result == 10
        assert self.processor.processed_count == 1

    def test_process_multiple(self) -> None:
        """Test processing multiple values."""
        self.processor.process(1)
        self.processor.process(2)
        assert self.processor.processed_count == 2
