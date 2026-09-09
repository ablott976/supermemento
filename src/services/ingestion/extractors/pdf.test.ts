import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { DocumentStatus, ContentType } from "../../../types/enums.js";
import type { Document } from "../../../types/models.js";
import { PdfExtractor } from "./pdf.js";

function makeDocument(overrides: Partial<Document> = {}): Document {
  return {
    id: "doc-1",
    title: "PDF Doc",
    contentType: ContentType.Pdf,
    rawContent: "",
    containerTag: "default",
    metadata: {},
    status: DocumentStatus.Queued,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

describe("PdfExtractor", () => {
  it("parses a real base64 PDF with the installed parser", async () => {
    const stream = "BT /F1 12 Tf 20 100 Td (BioNCard battlecard) Tj ET";
    const objects = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
      `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`
    ];
    let pdf = "%PDF-1.4\n";
    const offsets = objects.map((object, i) => {
      const offset = Buffer.byteLength(pdf);
      pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
      return offset;
    });
    const xref = Buffer.byteLength(pdf);
    pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    const result = await new PdfExtractor().extract(makeDocument({ rawContent: Buffer.from(pdf).toString("base64") }));
    assert.match(result, /BioNCard battlecard/);
  });

  it("extract trims parsed text", async () => {
    const extractor = new PdfExtractor() as PdfExtractor & {
      getPdfBuffer: (doc: Document) => Promise<Buffer>;
      loadPdfParser: () => Promise<(dataBuffer: Buffer) => Promise<{ text?: string }>>;
    };

    extractor.getPdfBuffer = async () => Buffer.from("%PDF-1.4 mock", "utf8");
    extractor.loadPdfParser = async () => async () => ({ text: "  extracted text  \n" });

    const result = await extractor.extract(makeDocument());

    assert.equal(result, "extracted text");
  });

  it("reads PDF bytes from filePath", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "pdf-extractor-test-"));
    const filePath = join(tempDir, "sample.pdf");

    try {
      await writeFile(filePath, Buffer.from("%PDF-1.7 content", "utf8"));

      const extractor = new PdfExtractor() as PdfExtractor & {
        loadPdfParser: () => Promise<(dataBuffer: Buffer) => Promise<{ text?: string }>>;
      };

      extractor.loadPdfParser = async () => async (buffer: Buffer) => {
        assert.equal(buffer.subarray(0, 5).toString("ascii"), "%PDF-");
        return { text: "from file" };
      };

      const result = await extractor.extract(makeDocument({ filePath }));
      assert.equal(result, "from file");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("accepts base64 encoded rawContent", async () => {
    const extractor = new PdfExtractor() as PdfExtractor & {
      getPdfBuffer: (doc: Document) => Promise<Buffer>;
    };

    const pdfBytes = Buffer.from("%PDF-1.4\nmock", "utf8");
    const buffer = await extractor.getPdfBuffer(
      makeDocument({ rawContent: pdfBytes.toString("base64") })
    );

    assert.equal(buffer.subarray(0, 5).toString("ascii"), "%PDF-");
  });

  it("accepts utf8 rawContent when it contains PDF bytes", async () => {
    const extractor = new PdfExtractor() as PdfExtractor & {
      getPdfBuffer: (doc: Document) => Promise<Buffer>;
    };

    const buffer = await extractor.getPdfBuffer(makeDocument({ rawContent: "%PDF-1.4\nmock" }));

    assert.equal(buffer.subarray(0, 5).toString("ascii"), "%PDF-");
  });

  it("throws when rawContent is missing and filePath is not provided", async () => {
    const extractor = new PdfExtractor();

    await assert.rejects(
      () => extractor.extract(makeDocument({ rawContent: "" })),
      /PDF extractor requires document\.filePath or rawContent/
    );
  });

  it("throws when rawContent is not valid PDF bytes", async () => {
    const extractor = new PdfExtractor();

    await assert.rejects(
      () => extractor.extract(makeDocument({ rawContent: "plain text" })),
      /PDF rawContent did not contain valid PDF bytes/
    );
  });

  it("wraps file read errors with file path context", async () => {
    const extractor = new PdfExtractor();
    const missingPath = "/tmp/definitely-missing-pdf-file.pdf";

    await assert.rejects(
      () => extractor.extract(makeDocument({ filePath: missingPath })),
      new RegExp(`Failed to read PDF file at ${missingPath}`)
    );
  });
});
