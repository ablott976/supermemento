from abc import ABC, abstractmethod

from src.types.models import Document


class Extractor(ABC):
    """Base document text extractor interface."""
    
    @abstractmethod
    async def extract(self, doc: Document) -> str:
        """Extracts plain text from the input document.
        
        Args:
            doc: Source document.
            
        Returns:
            Extracted plain text content.
        """
        ...
