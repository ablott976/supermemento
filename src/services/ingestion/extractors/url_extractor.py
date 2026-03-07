import re

from src.types.models import Document

from .base import Extractor


class UrlExtractor(Extractor):
    """Extractor for URL documents using fetch + basic HTML-to-text cleanup."""

    async def extract(self, doc: Document) -> str:
        """Fetches the URL and extracts readable text.
        
        Args:
            doc: Source document.
            
        Returns:
            Extracted text from HTML.
            
        Raises:
            ValueError: If URL is missing or fetch fails.
        """
        import aiohttp
        
        url = doc.source_url or doc.raw_content
        if not url:
            raise ValueError(
                "URL extractor requires sourceUrl or rawContent containing a URL"
            )

        async with aiohttp.ClientSession() as session:
            async with session.get(
                url,
                headers={
                    "User-Agent": "Supermemento/2.0 (+https://supermemento.local)"
                }
            ) as response:
                if response.status != 200:
                    raise ValueError(
                        f"Failed to fetch URL ({response.status}): {url}"
                    )
                html = await response.text()
                return self._html_to_text(html)

    def _html_to_text(self, html: str) -> str:
        """Convert HTML to plain text."""
        # Remove scripts and styles
        without_scripts = re.sub(
            r'<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>',
            ' ',
            html,
            flags=re.IGNORECASE | re.DOTALL
        )
        without_styles = re.sub(
            r'<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>',
            ' ',
            without_scripts,
            flags=re.IGNORECASE | re.DOTALL
        )
        without_noscript = re.sub(
            r'<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>',
            ' ',
            without_styles,
            flags=re.IGNORECASE | re.DOTALL
        )

        # Replace common tags with newlines
        decoded = without_noscript
        decoded = re.sub(r'<\s*br\s*\/?>', '\n', decoded, flags=re.IGNORECASE)
        decoded = re.sub(
            r'<\s*\/\s*(?:p|div|h[1-6]|li|section|article)\s*>',
            '\n',
            decoded,
            flags=re.IGNORECASE
        )
        
        # Remove remaining tags
        decoded = re.sub(r'<[^>]+>', ' ', decoded)
        
        # Decode HTML entities
        decoded = decoded.replace('&nbsp;', ' ')
        decoded = decoded.replace('&amp;', '&')
        decoded = decoded.replace('&lt;', '<')
        decoded = decoded.replace('&gt;', '>')
        decoded = decoded.replace('&quot;', '"')
        decoded = decoded.replace('&#39;', "'")

        # Clean up whitespace
        lines = [
            line.strip() 
            for line in decoded.split('\n') 
            if line.strip()
        ]
        return '\n'.join(lines)
