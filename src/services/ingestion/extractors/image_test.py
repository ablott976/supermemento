import base64
import pytest
from pathlib import Path
from unittest.mock import AsyncMock, patch
from src.services.ingestion.extractors.image import ImageExtractor
from src.types.models import Document
from src.types.enums import ContentType, DocumentStatus


def make_document(overrides: dict | None = None) -> Document:
    """Helper to create a test document with defaults."""
    defaults = {
        "id": "doc-1",
        "title": "Image Doc",
        "content_type": ContentType.Image,
        "raw_content": "",
        "container_tag": "default",
        "metadata": {},
        "status": DocumentStatus.Queued,
        "file_path": None,
    }
    if overrides:
        defaults.update(overrides)
    return Document(**defaults)


@pytest.fixture
def extractor() -> ImageExtractor:
    return ImageExtractor()


@pytest.fixture
def sample_image_bytes() -> bytes:
    """PNG file signature followed by minimal content."""
    return bytes([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) + b"mock-image-data"


@pytest.mark.asyncio
async def test_extract_trims_ocr_text(extractor: ImageExtractor) -> None:
    """Test that extracted OCR text is properly trimmed."""
    mock_tesseract = AsyncMock()
    mock_tesseract.recognize.return_value = {"data": {"text": "  detected text  \n"}}

    with patch.object(extractor, "_load_tesseract", return_value=mock_tesseract):
        with patch.object(extractor, "_get_image_buffer", return_value=b"mock-image"):
            doc = make_document({"raw_content": "base64encoded"})
            result = await extractor.extract(doc)

    assert result == "detected text"
    mock_tesseract.recognize.assert_called_once()
    call_args = mock_tesseract.recognize.call_args
    assert call_args[0][0] == b"mock-image"
    assert call_args[1].get("language") == "eng"


@pytest.mark.asyncio
async def test_reads_image_bytes_from_file_path(
    extractor: ImageExtractor, tmp_path: Path, sample_image_bytes: bytes
) -> None:
    """Test reading image bytes from a file path."""
    image_file = tmp_path / "sample.png"
    image_file.write_bytes(sample_image_bytes)

    doc = make_document({"file_path": str(image_file)})
    buffer = await extractor._get_image_buffer(doc)

    assert buffer == sample_image_bytes


@pytest.mark.asyncio
async def test_accepts_image_data_url_in_raw_content(
    extractor: ImageExtractor, sample_image_bytes: bytes
) -> None:
    """Test handling of data:image/png;base64 URLs."""
    b64_content = base64.b64encode(sample_image_bytes).decode("utf-8")
    raw_content = f"data:image/png;base64,{b64_content}"

    doc = make_document({"raw_content": raw_content})
    buffer = await extractor._get_image_buffer(doc)

    assert buffer == sample_image_bytes


@pytest.mark.asyncio
async def test_accepts_base64_encoded_raw_content(
    extractor: ImageExtractor, sample_image_bytes: bytes
) -> None:
    """Test handling of plain base64 encoded content."""
    b64_content = base64.b64encode(sample_image_bytes).decode("utf-8")

    doc = make_document({"raw_content": b64_content})
    buffer = await extractor._get_image_buffer(doc)

    assert buffer == sample_image_bytes


@pytest.mark.asyncio
async def test_falls_back_to_utf8_raw_content_when_not_base64(
    extractor: ImageExtractor,
) -> None:
    """Test that non-base64 content is treated as UTF-8 text."""
    raw_content = "plain image description"

    doc = make_document({"raw_content": raw_content})
    buffer = await extractor._get_image_buffer(doc)

    assert buffer.decode("utf-8") == raw_content


@pytest.mark.asyncio
async def test_throws_when_raw_content_missing_and_file_path_not_provided(
    extractor: ImageExtractor,
) -> None:
    """Test error when neither raw_content nor file_path is provided."""
    doc = make_document({"raw_content": "", "file_path": None})

    with pytest.raises(
        ValueError, match="Image extractor requires document.file_path or rawContent"
    ):
        await extractor.extract(doc)


@pytest.mark.asyncio
async def test_throws_when_raw_content_is_empty_after_trimming(
    extractor: ImageExtractor,
) -> None:
    """Test error when raw_content contains only whitespace."""
    doc = make_document({"raw_content": " \n\t "})

    with pytest.raises(ValueError, match="Image rawContent was empty"):
        await extractor.extract(doc)


@pytest.mark.asyncio
async def test_wraps_file_read_errors_with_file_path_context(
    extractor: ImageExtractor,
) -> None:
    """Test that file read errors include the file path in the message."""
    missing_path = "/tmp/definitely-missing-image-file.png"
    doc = make_document({"file_path": missing_path})

    with pytest.raises(
        RuntimeError, match=f"Failed to read image file at {missing_path}"
    ):
        await extractor.extract(doc)
