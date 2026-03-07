import json

from src.types.models import Document

from .base import Extractor


class ConversationExtractor(Extractor):
    """Extractor for chat/conversation input."""

    async def extract(self, doc: Document) -> str:
        """Normalizes conversation content to structured speaker turns.
        
        Args:
            doc: Source document.
            
        Returns:
            Normalized conversation text.
        """
        raw = doc.raw_content.strip()
        
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                lines = []
                for entry in parsed:
                    if isinstance(entry, dict):
                        speaker = str(entry.get("speaker", "unknown"))
                        message = str(entry.get("message", ""))
                        if message:
                            lines.append(f"{speaker}: {message}")
                
                if lines:
                    return "\n".join(lines)
        except json.JSONDecodeError:
            pass  # Fall through to line-based parsing

        # Line-based parsing
        normalized_lines = []
        for line in raw.splitlines():
            line = line.strip()
            if not line:
                continue
            
            # Try to match speaker: message format
            import re
            match = re.match(r'^([^:]{1,60}):\s*(.+)$', line)
            if not match:
                normalized_lines.append(f"unknown: {line}")
            else:
                speaker = match.group(1).strip() or "unknown"
                message = match.group(2).strip()
                normalized_lines.append(f"{speaker}: {message}")
        
        return "\n".join(normalized_lines)
