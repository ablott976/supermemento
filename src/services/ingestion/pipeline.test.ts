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
