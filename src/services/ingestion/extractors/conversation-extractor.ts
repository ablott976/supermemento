import type { Document } from "../../../types/models.js";
import type { Extractor } from "./base.js";

/** Extractor for chat/conversation input. */
export class ConversationExtractor implements Extractor {
  /**
   * Normalizes conversation content to structured speaker turns.
   * @param doc Source document.
   */
  public async extract(doc: Document): Promise<string> {
    const raw = doc.rawContent.trim();

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        const lines = parsed
          .map((entry) => {
            if (typeof entry === "object" && entry !== null) {
              const speaker = String((entry as Record<string, unknown>).speaker ?? "unknown");
              const message = String((entry as Record<string, unknown>).message ?? "");
              return `${speaker}: ${message}`;
            }
            return null;
          })
          .filter((line): line is string => Boolean(line));

        if (lines.length > 0) {
          return lines.join("\n");
        }
      }
    } catch {
      // Fall through to line-based parsing.
    }

    const normalizedLines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        const match = line.match(/^([^:]{1,60}):\s*(.+)$/);
        if (!match) {
          return `unknown: ${line}`;
        }

        const speaker = match[1]?.trim() ?? "unknown";
        const message = match[2]?.trim() ?? "";
        return `${speaker}: ${message}`;
      });

    return normalizedLines.join("\n");
  }
}
