/** Supported content types for a source document. */
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
