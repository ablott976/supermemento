import type { Document } from "../../../types/models.js";
import type { Extractor } from "./base.js";

/** Extractor for URL documents using fetch + basic HTML-to-text cleanup. */
export class UrlExtractor implements Extractor {
  /**
   * Fetches the URL and extracts readable text.
   * @param doc Source document.
   */
  public async extract(doc: Document): Promise<string> {
    const url = doc.sourceUrl ?? doc.rawContent;
    if (!url) {
      throw new Error("URL extractor requires sourceUrl or rawContent containing a URL");
    }

    const response = await fetch(url, {
      headers: {
        "user-agent": "Supermemento/2.0 (+https://supermemento.local)"
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch URL (${response.status}): ${url}`);
    }

    const html = await response.text();
    return this.htmlToText(html);
  }

  private htmlToText(html: string): string {
    const withoutScripts = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
      .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, " ");

    const decoded = withoutScripts
      .replace(/<\s*br\s*\/?>/gi, "\n")
      .replace(/<\s*\/\s*(p|div|h1|h2|h3|h4|h5|h6|li|section|article)\s*>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");

    return decoded
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join("\n");
  }
}
