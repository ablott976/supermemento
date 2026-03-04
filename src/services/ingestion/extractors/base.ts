import type { Document } from "../../../types/models.js";

/** Base document text extractor interface. */
export interface Extractor {
  /**
   * Extracts plain text from the input document.
   * @param doc Source document.
   */
  extract(doc: Document): Promise<string>;
}
