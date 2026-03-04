import type { Document } from "../../../types/models.js";
import type { Extractor } from "./base.js";

/** Extractor for plain text documents. */
export class TextExtractor implements Extractor {
  /**
   * Returns raw content as-is.
   * @param doc Source document.
   */
  public async extract(doc: Document): Promise<string> {
    return doc.rawContent;
  }
}
