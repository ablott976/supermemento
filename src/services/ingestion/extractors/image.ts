import { readFile } from "node:fs/promises";

import type { Document } from "../../../types/models.js";
import type { Extractor } from "./base.js";

type OcrResult = {
  data?: {
    text?: string;
  };
};

type TesseractModule = {
  recognize?: (image: Buffer, language?: string) => Promise<OcrResult>;
};

/** Extractor for image documents. */
export class ImageExtractor implements Extractor {
  /**
   * Reads an image and extracts text content via OCR.
   * @param doc Source document.
   */
  public async extract(doc: Document): Promise<string> {
    const imageBuffer = await this.getImageBuffer(doc);
    const tesseract = await this.loadTesseract();
    const result = await tesseract.recognize?.(imageBuffer, "eng");

    return (result?.data?.text ?? "").trim();
  }

  private async getImageBuffer(doc: Document): Promise<Buffer> {
    if (doc.filePath) {
      try {
        return await readFile(doc.filePath);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to read image file at ${doc.filePath}: ${detail}`);
      }
    }

    if (!doc.rawContent) {
      throw new Error("Image extractor requires document.filePath or rawContent");
    }

    const raw = doc.rawContent.trim();
    if (!raw) {
      throw new Error("Image rawContent was empty");
    }

    const dataUrlMatch = raw.match(/^data:image\/[a-zA-Z0-9+.-]+;base64,(.+)$/);
    if (dataUrlMatch?.[1]) {
      return Buffer.from(dataUrlMatch[1], "base64");
    }

    if (this.looksLikeBase64(raw)) {
      return Buffer.from(raw, "base64");
    }

    return Buffer.from(raw, "utf8");
  }

  private looksLikeBase64(content: string): boolean {
    const compact = content.replace(/\s/g, "");
    if (!compact || compact.length % 4 !== 0) {
      return false;
    }

    return /^[A-Za-z0-9+/]+={0,2}$/.test(compact);
  }

  private async loadTesseract(): Promise<Required<TesseractModule>> {
    try {
      // @ts-ignore - optional dependency, loaded dynamically
      const mod = (await import("tesseract.js")) as TesseractModule;
      if (!mod.recognize) {
        throw new Error("tesseract.js recognize export is unavailable");
      }

      return {
        recognize: mod.recognize
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to load tesseract.js dependency: ${detail}`);
    }
  }
}
