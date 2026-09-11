import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ContentType } from "../../types/enums.js";
import { ConversationExtractor, TextExtractor, UrlExtractor } from "./extractors/index.js";
import { ImageExtractor } from "./extractors/image.js";
import { PdfExtractor } from "./extractors/pdf.js";
import { IngestionPipeline } from "./pipeline.js";

function makePipeline(): IngestionPipeline {
  return new IngestionPipeline({} as never, {} as never, {} as never, {} as never);
}

function getExtractor(contentType: ContentType): unknown {
  const pipeline = makePipeline() as unknown as {
    getExtractor: (value: ContentType) => unknown;
  };

  return pipeline.getExtractor(contentType);
}

describe("IngestionPipeline.getExtractor", () => {
  it("returns UrlExtractor for URL content", () => {
    const extractor = getExtractor(ContentType.Url);
    assert.equal(extractor instanceof UrlExtractor, true);
  });

  it("returns PdfExtractor for PDF content", () => {
    const extractor = getExtractor(ContentType.Pdf);
    assert.equal(extractor instanceof PdfExtractor, true);
  });

  it("returns ImageExtractor for image content", () => {
    const extractor = getExtractor(ContentType.Image);
    assert.equal(extractor instanceof ImageExtractor, true);
  });

  it("returns ConversationExtractor for conversation content", () => {
    const extractor = getExtractor(ContentType.Conversation);
    assert.equal(extractor instanceof ConversationExtractor, true);
  });

  it("returns TextExtractor for text content", () => {
    const extractor = getExtractor(ContentType.Text);
    assert.equal(extractor instanceof TextExtractor, true);
  });

  it("falls back to TextExtractor for unsupported binary content", () => {
    const videoExtractor = getExtractor(ContentType.Video);
    const audioExtractor = getExtractor(ContentType.Audio);

    assert.equal(videoExtractor instanceof TextExtractor, true);
    assert.equal(audioExtractor instanceof TextExtractor, true);
  });
});

describe("IngestionPipeline memory policy", () => {
  type Created = Record<string, unknown>;

  function fakeDocument(metadata: Record<string, unknown>) {
    return {
      id: "document-1",
      title: "Lista de precios",
      contentType: ContentType.Text,
      rawContent: "Precio A 10.\n\nPrecio B 20.",
      sourceUrl: null,
      filePath: null,
      containerTag: "test",
      metadata,
      status: "queued",
      createdAt: "2026-09-10T00:00:00.000Z",
      updatedAt: "2026-09-10T00:00:00.000Z"
    };
  }

  async function run(metadata: Record<string, unknown>, extracted: Array<Record<string, unknown>>, existingHashes: string[] = []) {
    const created: Created[] = [];
    const updates: Array<Record<string, unknown>> = [];
    const embeddingCalls: string[][] = [];
    const neo4jClient = {
      getDocument: async () => fakeDocument(metadata),
      updateDocument: async (_id: string, input: Record<string, unknown>) => { updates.push(input); return { ...fakeDocument(metadata), ...input }; },
      getContainerFilterPrompt: async () => null,
      createChunks: async () => [],
      findActiveMemoryByContentHash: async (_tag: string, hash: string) => existingHashes.includes(hash) ? { id: `existing-${hash.slice(0, 6)}` } : null,
      createMemory: async (input: Created) => { created.push(input); return { id: `memory-${created.length}`, ...input }; }
    };
    const embeddingService = {
      generateEmbeddings: async (contents: string[]) => { embeddingCalls.push(contents); return contents.map(() => [0.1]); }
    };
    const relationClassifierService = { classifyAndApply: async () => ({}) };
    const memoryExtractorService = { extractFromChunk: async () => extracted };
    const pipeline = new IngestionPipeline(
      neo4jClient as never, embeddingService as never, relationClassifierService as never, memoryExtractorService as never
    );
    const result = await pipeline.processDocument("document-1");
    return { result, created, updates, embeddingCalls };
  }

  it("inherits the document validTo, rejects temporal memories without one and drops exact duplicates", async () => {
    const { result, created, updates, embeddingCalls } = await run(
      { temporal_class: "pricing", valid_to: "2026-12-31T00:00:00Z" },
      [
        { content: "Precio A 10 €", memoryType: "fact", confidence: 0.9, validFrom: null, validTo: null },
        { content: "precio a 10 €!", memoryType: "fact", confidence: 0.9, validFrom: null, validTo: null },
        { content: "Precio B 20 €", memoryType: "fact", confidence: 0.9, validFrom: null, validTo: "2026-10-31T00:00:00Z" }
      ]
    );
    // Both paragraphs fit in one chunk, so the extractor runs once; the second proposal is a duplicate within the document.
    assert.equal(result.memoryCount, 2);
    assert.equal(result.duplicateCount, 1);
    assert.equal(result.rejectedCount, 0);
    assert.deepEqual(created.map((memory) => [memory.content, memory.validTo, memory.metadata]), [
      ["Precio A 10 €", "2026-12-31T00:00:00Z", { temporal_class: "pricing" }],
      ["Precio B 20 €", "2026-10-31T00:00:00Z", { temporal_class: "pricing" }]
    ]);
    // Memory embeddings are only generated for accepted memories (second call; the first is for chunks).
    assert.deepEqual(embeddingCalls[1], ["Precio A 10 €", "Precio B 20 €"]);
    const final = updates.at(-1)?.metadata as Record<string, unknown>;
    assert.deepEqual(final, { temporal_class: "pricing", valid_to: "2026-12-31T00:00:00Z", memories_created: 2, memories_duplicate: 1, memories_rejected: 0 });
  });

  it("normalises date-only validity from the extractor and the document to Europe/Madrid business days", async () => {
    const { result, created } = await run(
      { temporal_class: "pricing", valid_to: "2026-09-11" },
      [
        { content: "Precio hereda el día del documento", memoryType: "fact", confidence: 0.9, validFrom: "2026-09-01", validTo: null },
        { content: "Precio con día propio", memoryType: "fact", confidence: 0.9, validFrom: null, validTo: "2026-01-10" },
        { content: "Precio con instante propio", memoryType: "fact", confidence: 0.9, validFrom: "2026-09-01T10:00:00Z", validTo: "2026-09-11T08:00:00Z" }
      ]
    );
    assert.equal(result.memoryCount, 3);
    assert.deepEqual(created.map((memory) => [memory.validFrom, memory.validTo]), [
      ["2026-08-31T22:00:00.000Z", "2026-09-11T21:59:59.999Z"],  // CEST: day starts 22:00Z the day before, ends 21:59:59.999Z
      [undefined, "2026-01-10T22:59:59.999Z"],                     // CET: ends 22:59:59.999Z
      ["2026-09-01T10:00:00Z", "2026-09-11T08:00:00Z"]              // full instants pass through unchanged
    ]);
  });

  it("rejects every temporal memory when neither the memory nor the document has validTo", async () => {
    const { result, created, embeddingCalls } = await run(
      { temporal_class: "roadmap" },
      [{ content: "Función X en Q4", memoryType: "fact", confidence: 0.9, validFrom: null, validTo: null }]
    );
    assert.equal(result.memoryCount, 0);
    assert.equal(result.rejectedCount, 1);
    assert.equal(created.length, 0);
    assert.equal(embeddingCalls.length, 1, "no embedding call for rejected memories");
  });

  it("skips memories that already exist actively in the container and keeps legacy documents permissive", async () => {
    const { memoryContentHash } = await import("../memory-policy.js");
    const { result, created } = await run(
      { crawledBy: "web_crawler" },
      [
        { content: "GTC significa GoTimeCloud", memoryType: "fact", confidence: 0.9, validFrom: null, validTo: null },
        { content: "Sin fecha de caducidad", memoryType: "fact", confidence: 0.9, validFrom: null, validTo: null }
      ],
      [memoryContentHash("test", "gtc significa GOTIMECLOUD")]
    );
    assert.equal(result.memoryCount, 1);
    assert.equal(result.rejectedCount, 0);
    assert.deepEqual(created.map((memory) => [memory.content, memory.validTo, memory.metadata]), [
      ["Sin fecha de caducidad", undefined, { temporal_class: "none" }]
    ]);
  });
});
