from pathlib import Path

from pypdf import PdfReader
from src.types.models import Document

from .base import Extractor


class PdfExtractor(Extractor):
    """Extracts text content from PDF documents using pypdf."""

    async def extract(self, doc: Document) -> str:
        """Extract text from PDF file.

        Args:
            doc: Source document with file_path pointing to PDF.

        Returns:
            Extracted text content from all pages.

        Raises:
            ValueError: If file_path is missing from document.
            FileNotFoundError: If PDF file does not exist.
            RuntimeError: If text extraction fails.
        """
        if not doc.file_path:
            raise ValueError("PDF document must have a file_path")

        path = Path(doc.file_path)
        if not path.exists():
            raise FileNotFoundError(f"PDF file not found: {doc.file_path}")

        try:
            reader = PdfReader(str(path))
            text_parts: list[str] = []

            for page in reader.pages:
                page_text = page.extract_text()
                if page_text:
                    text_parts.append(page_text)

            return "\n\n".join(text_parts)

        except Exception as e:
            raise RuntimeError(
                f"Failed to extract text from PDF {doc.file_path}: {e}"
            ) from e
