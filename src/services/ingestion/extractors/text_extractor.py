from src.types.models import Document

from .base import Extractor


class TextExtractor(Extractor):
    """Extractor for plain text documents."""

    async def extract(self, doc: Document) -> str:
        """Returns raw content as-is.
        
        Args:
            doc: Source document.
            
        Returns:
            Raw content unchanged.
        """
        return doc.raw_content
