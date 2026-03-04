import type { ContentType } from "../../types/enums.js";
import type { Document, Metadata } from "../../types/models.js";

export interface ChunkPayload {
  content: string;
  chunkIndex: number;
  metadata: Metadata;
}

/** Intelligent content chunking service. */
export class ChunkingService {
  /**
   * Splits extracted text into contextual chunks.
   * @param doc Source document.
   * @param extractedText Plain text extracted from document.
   */
  public chunk(doc: Document, extractedText: string): ChunkPayload[] {
    const sourceText = extractedText.trim();
    if (!sourceText) {
      return [];
    }

    if (doc.contentType === "conversation") {
      return this.chunkConversation(doc, sourceText);
    }

    if (doc.contentType === "url") {
      return this.chunkBySections(doc, sourceText);
    }

    return this.chunkTextLike(doc, sourceText);
  }

  private chunkTextLike(doc: Document, text: string): ChunkPayload[] {
    const blocks = text
      .split(/\n\s*\n/g)
      .map((block) => block.trim())
      .filter((block) => block.length > 0);

    return this.packBlocks(doc, blocks, 3800, 1800, "paragraph");
  }

  private chunkBySections(doc: Document, text: string): ChunkPayload[] {
    const blocks = text
      .split(/\n(?=#+\s|[A-Z][A-Za-z\s]{2,80}:\s*$)/g)
      .map((block) => block.trim())
      .filter((block) => block.length > 0);

    return this.packBlocks(doc, blocks, 3800, 1800, "section");
  }

  private chunkConversation(doc: Document, text: string): ChunkPayload[] {
    const turns = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const chunks: ChunkPayload[] = [];
    let chunkIndex = 0;

    for (let i = 0; i < turns.length; i += 4) {
      const group = turns.slice(i, i + 4);
      const content = this.withContext(doc, group.join("\n"), `Conversation turns ${i + 1}-${i + group.length}`);
      chunks.push({
        content,
        chunkIndex,
        metadata: {
          strategy: "conversation_turns",
          startTurn: i + 1,
          endTurn: i + group.length
        }
      });
      chunkIndex += 1;
    }

    return chunks;
  }

  private packBlocks(
    doc: Document,
    blocks: string[],
    maxChars: number,
    minChars: number,
    strategy: string
  ): ChunkPayload[] {
    const chunks: ChunkPayload[] = [];
    let current = "";
    let chunkIndex = 0;
    let startBlock = 0;

    const flush = (endBlock: number): void => {
      const trimmed = current.trim();
      if (!trimmed) {
        return;
      }

      chunks.push({
        content: this.withContext(doc, trimmed),
        chunkIndex,
        metadata: {
          strategy,
          startBlock,
          endBlock
        }
      });
      chunkIndex += 1;
      current = "";
      startBlock = endBlock + 1;
    };

    for (let i = 0; i < blocks.length; i += 1) {
      const block = blocks[i] ?? "";
      const candidate = current ? `${current}\n\n${block}` : block;

      if (candidate.length > maxChars && current.length >= minChars) {
        flush(i - 1);
      }

      current = current ? `${current}\n\n${block}` : block;

      if (current.length >= maxChars) {
        flush(i);
      }
    }

    if (current.trim()) {
      flush(blocks.length - 1);
    }

    return chunks;
  }

  private withContext(doc: Document, content: string, sectionTitle?: string): string {
    const prefix = [
      `Document: ${doc.title}`,
      `Type: ${doc.contentType as ContentType}`,
      sectionTitle ? `Section: ${sectionTitle}` : null,
      ""
    ]
      .filter((part): part is string => part !== null)
      .join("\n");

    return `${prefix}${content}`;
  }
}
