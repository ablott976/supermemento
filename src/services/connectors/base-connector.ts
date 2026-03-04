import { createHash } from "node:crypto";
import { ContentType } from "../../types/enums.js";
import { Neo4jClient } from "../../db/neo4j-client.js";
import { IngestionPipeline } from "../ingestion/pipeline.js";

export interface ConnectorDocument {
  title: string;
  content: string;
  containerTag: string;
  sourceUrl?: string;
  metadata?: Record<string, unknown>;
}

/** Base connector abstraction for external sources. */
export abstract class BaseConnector {
  protected readonly neo4jClient: Neo4jClient;
  protected readonly ingestionPipeline: IngestionPipeline;

  /**
   * Creates a connector instance.
   */
  protected constructor(neo4jClient: Neo4jClient, ingestionPipeline: IngestionPipeline) {
    this.neo4jClient = neo4jClient;
    this.ingestionPipeline = ingestionPipeline;
  }

  /**
   * Fetches source documents from an external system.
   */
  public abstract fetch(): Promise<ConnectorDocument[]>;

  /**
   * Checks whether a document is already indexed by source URL or content hash.
   * @param doc Source document.
   */
  public async dedup(doc: ConnectorDocument): Promise<{ isDuplicate: boolean; contentHash: string }> {
    const contentHash = this.hashContent(doc.content);

    if (doc.sourceUrl) {
      const existingByUrl = await this.neo4jClient.findDocumentBySourceUrl(doc.sourceUrl);
      if (existingByUrl) {
        const existingHash = String(existingByUrl.metadata.contentHash ?? "");
        if (existingHash && existingHash === contentHash) {
          return { isDuplicate: true, contentHash };
        }
      }
    }

    const existingByHash = await this.neo4jClient.findDocumentByContentHash(doc.containerTag, contentHash);
    return { isDuplicate: existingByHash !== null, contentHash };
  }

  /**
   * Sends a connector document through ingestion pipeline.
   * @param doc Source document.
   */
  public async ingest(doc: ConnectorDocument): Promise<{
    documentId: string;
    chunkCount: number;
    memoryCount: number;
  }> {
    const { contentHash } = await this.dedup(doc);
    const now = new Date().toISOString();

    const result = await this.ingestionPipeline.ingest({
      title: doc.title,
      contentType: ContentType.Url,
      rawContent: doc.content,
      containerTag: doc.containerTag,
      sourceUrl: doc.sourceUrl,
      metadata: {
        ...(doc.metadata ?? {}),
        contentHash,
        lastCrawledAt: now
      }
    });

    return {
      documentId: result.document.id,
      chunkCount: result.chunkCount,
      memoryCount: result.memoryCount
    };
  }

  protected hashContent(content: string): string {
    return createHash("sha256").update(content, "utf8").digest("hex");
  }
}
