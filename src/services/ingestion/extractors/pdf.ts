import { readFile } from "node:fs/promises";

import type { Document } from "../../../types/models.js";
import type { Extractor } from "./base.js";
import { fetchPublicUrl } from "./public-url.js";

type PdfParseResult = {
  text?: string;
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

    if (/^https?:\/\//i.test(doc.rawContent.trim())) {
      const buffer = await fetchPublicUrl(doc.rawContent.trim());
      if (!this.looksLikePdf(buffer)) throw new Error("URL did not return PDF bytes");
      return buffer;
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
      const { PDFParse } = await import("pdf-parse");
      return async (buffer: Buffer) => {
        const parser = new PDFParse({ data: new Uint8Array(buffer), isEvalSupported: false });
        try {
          return await parser.getText();
        } finally {
          await parser.destroy();
        }
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to load pdf-parse dependency: ${detail}`);
    }
  }
}
