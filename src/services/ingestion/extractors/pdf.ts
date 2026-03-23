import { readFile } from "node:fs/promises";

import type { Document } from "../../../types/models.js";
import type { Extractor } from "./base.js";

type PdfParseResult = {
  text?: string;
};

type PdfParseModule = {
  default?: (dataBuffer: Buffer) => Promise<PdfParseResult>;
};

/** Extractor for PDF documents. */
export class PdfExtractor implements Extractor {
  /**
   * Reads a PDF from filePath and extracts text content.
   * @param doc Source document.
   */
  public async extract(doc: Document): Promise<string> {
    const buffer = await this.getPdfBuffer(doc);
    const parse = await this.loadPdfParser();
    const parsed = await parse(buffer);

    return (parsed.text ?? "").trim();
  }

  private async getPdfBuffer(doc: Document): Promise<Buffer> {
    if (doc.filePath) {
      try {
        return await readFile(doc.filePath);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to read PDF file at ${doc.filePath}: ${detail}`);
      }
    }

    if (!doc.rawContent) {
      throw new Error("PDF extractor requires document.filePath or rawContent");
    }

    const fromBase64 = Buffer.from(doc.rawContent, "base64");
    if (this.looksLikePdf(fromBase64)) {
      return fromBase64;
    }

    const fromUtf8 = Buffer.from(doc.rawContent, "utf8");
    if (this.looksLikePdf(fromUtf8)) {
      return fromUtf8;
    }

    throw new Error("PDF rawContent did not contain valid PDF bytes");
  }

  private looksLikePdf(buffer: Buffer): boolean {
    return buffer.subarray(0, 5).toString("ascii") === "%PDF-";
  }

  private async loadPdfParser(): Promise<(dataBuffer: Buffer) => Promise<PdfParseResult>> {
    try {
      // @ts-ignore - optional dependency, loaded dynamically
      const mod = (await import("pdf-parse")) as PdfParseModule;
      const parse = mod.default;

      if (!parse) {
        throw new Error("pdf-parse default export is unavailable");
      }

      return parse;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to load pdf-parse dependency: ${detail}`);
    }
  }
}
