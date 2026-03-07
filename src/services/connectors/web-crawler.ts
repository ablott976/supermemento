import { ContentType, DocumentStatus } from "../../types/enums.js";
import { Neo4jClient } from "../../db/neo4j-client.js";
import { IngestionPipeline } from "../ingestion/pipeline.js";
import { UrlExtractor } from "../ingestion/extractors/url-extractor.js";
import { BaseConnector, type ConnectorDocument } from "./base-connector.js";

/**
 * URL crawler connector with content-change detection.
 * 
 * Note: The monolithic `crawl()` method has been removed in favor of
 * granular methods: `fetch()` for raw content extraction, `crawlUrl()`
 * for single URL ingestion with change detection, and `crawlUrls()` for
 * batch crawling with concurrency control and deduplication.
 */
export class WebCrawlerConnector extends BaseConnector {
  private readonly urls: string[];
  private readonly containerTag: string;

  /**
   * Creates web crawler connector.
   */
  public constructor(
    neo4jClient: Neo4jClient,
    ingestionPipeline: IngestionPipeline,
    urls: string[],
    containerTag: string
  ) {
    super(neo4jClient, ingestionPipeline);
    this.urls = urls;
    this.containerTag = containerTag;
  }

  /**
   * Fetches all configured URLs.
   * Replaces the legacy `crawl()` method for raw content extraction.
   */
  public async fetch(): Promise<ConnectorDocument[]> {
    const extractor = new UrlExtractor();
    const docs: ConnectorDocument[] = [];
    for (const url of this.urls) {
      const content = await extractor.extract({
        id: "temp",
        title: url,
        contentType: ContentType.Url,
        rawContent: "",
        sourceUrl: url,
        containerTag: this.containerTag,
        metadata: {},
        status: DocumentStatus.Queued,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      docs.push({
        title: url,
        content,
        containerTag: this.containerTag,
        sourceUrl: url,
        metadata: { crawledBy: "web_crawler", fetchedAt: new Date().toISOString() }
      });
    }
    return docs;
  }

  /**
   * Crawls one URL and ingests if changed.
   * Part of the new granular API replacing the monolithic `crawl()`.
   * @param url URL to crawl.
   * @param containerTag Target container.
   */
  public async crawlUrl(
    url: string,
    containerTag: string
  ): Promise<{ status: "ingested" | "skipped"; documentId?: string; }> {
    const batch = await this.crawlUrls([url], containerTag);
    const first = batch.results[0];
    if (!first) {
      return { status: "skipped" };
    }
    return {
      status: first.status,
      documentId: first.documentId
    };
  }

  /**
   * Crawls many URLs and ingests only changed content with limited concurrency.
   * Primary replacement for the removed `crawl()` method, providing better
   * control over concurrency and detailed result tracking.
   * @param urls URL list.
   * @param containerTag Target container.
   */
  public async crawlUrls(
    urls: string[],
    containerTag: string
  ): Promise<{
    crawled: number;
    ingested: number;
    skipped: number;
    results: Array<{ url: string; status: "ingested" | "skipped"; documentId?: string }>;
  }> {
    const extractor = new UrlExtractor();
    const concurrencyLimit = 5;
    const results: Array<{ url: string; status: "ingested" | "skipped"; documentId?: string }> = [];

    // Process URLs in chunks to limit concurrency while using Promise.all for parallel processing within each chunk
    for (let i = 0; i < urls.length; i += concurrencyLimit) {
      const chunk = urls.slice(i, i + concurrencyLimit);
      const chunkPromises = chunk.map(async (url): Promise<{ url: string; status: "ingested" | "skipped"; documentId?: string }> => {
        const content = await extractor.extract({
          id: "temp",
          title: url,
          contentType: ContentType.Url,
          rawContent: "",
          sourceUrl: url,
          containerTag,
          metadata: {},
          status: DocumentStatus.Queued,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });

        const doc: ConnectorDocument = {
          title: url,
          content,
          containerTag,
          sourceUrl: url,
          metadata: { crawledBy: "web_crawler", fetchedAt: new Date().toISOString() }
        };

        const dedup = await this.dedup(doc);
        if (dedup.isDuplicate) {
          return { url, status: "skipped" };
        }

        const ingestResult = await this.ingestionPipeline.ingest({
          title: doc.title,
          contentType: ContentType.Url,
          rawContent: doc.content,
          containerTag,
          sourceUrl: doc.sourceUrl,
          metadata: {
            ...(doc.metadata ?? {}),
            contentHash: dedup.contentHash,
            lastCrawledAt: new Date().toISOString()
          }
        });

        return {
          url,
          status: "ingested",
          documentId: ingestResult.document.id
        };
      });

      const chunkResults = await Promise.all(chunkPromises);
      results.push(...chunkResults);
    }

    const ingested = results.filter((item) => item.status === "ingested").length;
    const skipped = results.filter((item) => item.status === "skipped").length;

    return {
      crawled: urls.length,
      ingested,
      skipped,
      results
    };
  }
}
