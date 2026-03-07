/**
 * Supported content types for a source document.
 * 
 * Each content type is handled by a specific extractor in src/services/ingestion/extractors:
 * - Text: TextExtractor - Plain text content
 * - Url: UrlExtractor - Web content from URLs  
 * - Pdf: PdfExtractor - PDF document text extraction
 * - Image: ImageExtractor - OCR and image analysis (planned)
 * - Video: VideoExtractor - Video transcription (planned)
 * - Audio: AudioExtractor - Audio transcription (planned)
 * - Conversation: ConversationExtractor - Chat/conversation formats
 */
export enum ContentType {
  Text = "text",
  Url = "url",
  Pdf = "pdf",
  Image = "image",
  Video = "video",
  Audio = "audio",
  Conversation = "conversation"
}

/** Memory categorization used by Memento v2. */
export enum MemoryType {
  Fact = "fact",
  Preference = "preference",
  Episode = "episode",
  Derived = "derived"
}

/** Processing lifecycle for ingested documents. */
export enum DocumentStatus {
  Queued = "queued",
  Extracting = "extracting",
  Chunking = "chunking",
  ExtractingMemories = "extracting_memories",
  Embedding = "embedding",
  Indexing = "indexing",
  Done = "done",
  Error = "error"
}

/** Intelligent relation types between memories. */
export enum RelationType {
  Updates = "UPDATES",
  Extends = "EXTENDS",
  Derives = "DERIVES",
  ExtractedFrom = "EXTRACTED_FROM"
}
