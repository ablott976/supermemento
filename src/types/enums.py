from enum import Enum


class ContentType(str, Enum):
    """Supported content types for a source document."""

    TEXT = "text"
    URL = "url"
    PDF = "pdf"
    IMAGE = "image"
    VIDEO = "video"
    AUDIO = "audio"
    CONVERSATION = "conversation"


class MemoryType(str, Enum):
    """Memory categorization used by Memento v2."""

    FACT = "fact"
    PREFERENCE = "preference"
    EPISODE = "episode"
    DERIVED = "derived"


class DocumentStatus(str, Enum):
    """Processing lifecycle for ingested documents."""

    QUEUED = "queued"
    EXTRACTING = "extracting"
    CHUNKING = "chunking"
    EXTRACTING_MEMORIES = "extracting_memories"
    EMBEDDING = "embedding"
    INDEXING = "indexing"
    DONE = "done"
    ERROR = "error"


class RelationType(str, Enum):
    """Intelligent relation types between memories."""

    UPDATES = "UPDATES"
    EXTENDS = "EXTENDS"
    DERIVES = "DERIVES"
    EXTRACTED_FROM = "EXTRACTED_FROM"
