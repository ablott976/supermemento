import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { ContentType, DocumentStatus } from "../../../types/enums.js";
import type { Document } from "../../../types/models.js";
import { ImageExtractor } from "./image.js";

function makeDocument(overrides: Partial<Document> = {}): Document {
  return {
    id: "doc-1",
    title: "Image Doc",
    contentType: ContentType.Image,
    rawContent: "",
    containerTag: "default",
    metadata: {},
    status: DocumentStatus.Queued,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

describe("ImageExtractor", () => {
  it("extract trims OCR text", async () => {
    const extractor = new ImageExtractor() as ImageExtractor & {
      getImageBuffer: (doc: Document) => Promise<Buffer>;
      loadTesseract: () => Promise<{ recognize: (image: Buffer, language?: string) => Promise<{ data?: { text?: string } }> }>;
    };

    extractor.getImageBuffer = async () => Buffer.from("mock-image", "utf8");
    extractor.loadTesseract = async () => ({
      recognize: async (image: Buffer, language?: string) => {
        assert.equal(image.toString("utf8"), "mock-image");
        assert.equal(language, "eng");
        return { data: { text: "  detected text  \n" } };
      }
    });

    const result = await extractor.extract(makeDocument());
    assert.equal(result, "detected text");
  });

  it("reads image bytes from filePath", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "image-extractor-test-"));
    const filePath = join(tempDir, "sample.png");

    try {
      const payload = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      await writeFile(filePath, payload);

      const extractor = new ImageExtractor() as ImageExtractor & {
        getImageBuffer: (doc: Document) => Promise<Buffer>;
      };

      const buffer = await extractor.getImageBuffer(makeDocument({ filePath }));
      assert.equal(buffer.equals(payload), true);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("accepts image data URL in rawContent", async () => {
    const extractor = new ImageExtractor() as ImageExtractor & {
      getImageBuffer: (doc: Document) => Promise<Buffer>;
    };

    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const rawContent = `data:image/png;base64,${bytes.toString("base64")}`;

    const buffer = await extractor.getImageBuffer(makeDocument({ rawContent }));
    assert.equal(buffer.equals(bytes), true);
  });

  it("accepts base64 encoded rawContent", async () => {
    const extractor = new ImageExtractor() as ImageExtractor & {
      getImageBuffer: (doc: Document) => Promise<Buffer>;
    };

    const bytes = Buffer.from("image-bytes", "utf8");
    const buffer = await extractor.getImageBuffer(
      makeDocument({ rawContent: bytes.toString("base64") })
    );

    assert.equal(buffer.toString("utf8"), "image-bytes");
  });

  it("falls back to utf8 rawContent when not base64", async () => {
    const extractor = new ImageExtractor() as ImageExtractor & {
      getImageBuffer: (doc: Document) => Promise<Buffer>;
    };

    const rawContent = "plain image description";
    const buffer = await extractor.getImageBuffer(makeDocument({ rawContent }));

    assert.equal(buffer.toString("utf8"), rawContent);
  });

  it("throws when rawContent is missing and filePath is not provided", async () => {
    const extractor = new ImageExtractor();

    await assert.rejects(
      () => extractor.extract(makeDocument({ rawContent: "" })),
      /Image extractor requires document\.filePath or rawContent/
    );
  });

  it("throws when rawContent is empty after trimming", async () => {
    const extractor = new ImageExtractor();

    await assert.rejects(
      () => extractor.extract(makeDocument({ rawContent: "   \n\t   " })),
      /Image rawContent was empty/
    );
  });

  it("wraps file read errors with file path context", async () => {
    const extractor = new ImageExtractor();
    const missingPath = "/tmp/definitely-missing-image-file.png";

    await assert.rejects(
      () => extractor.extract(makeDocument({ filePath: missingPath })),
      new RegExp(`Failed to read image file at ${missingPath}`)
    );
  });
});
