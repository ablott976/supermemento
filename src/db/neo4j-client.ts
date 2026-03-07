import neo4j, { Driver, Integer } from "neo4j-driver";
import { v4 as uuidv4 } from "uuid";
import type { AppConfig } from "../config.js";
import { DocumentStatus, MemoryType, RelationType } from "../types/enums.js";
import type { Chunk, ChunkSearchHit, Document, Memory, MemoryRelation, MemorySearchHit, Metadata, Profile } from "../types/models.js";

type DocumentCreateInput = {
  title: string;
  contentType: Document["contentType"];
  rawContent: string;
  containerTag: string;
  metadata?: Metadata;
  sourceUrl?: string | null;
  filePath?: string | null;
};

type DocumentUpdateInput = {
  title?: string;
  rawContent?: string;
  metadata?: Metadata | string;
  status?: DocumentStatus;
};

type MemoryCreateInput = {
  content: string;
  memoryType: MemoryType;
  containerTag: string;
  confidence: number;
  embedding: number[];
  sourceDocId: string;
  validFrom?: string | null;
  validTo?: string | null;
};

type MemoryUpdateInput = {
  content?: string;
  memoryType?: MemoryType;
  isLatest?: boolean;
  confidence?: number;
  validFrom?: string | null;
  validTo?: string | null;
  forgottenAt?: string | null;
};

type ChunkCreateInput = {
  content: string;
  embedding: number[];
  chunkIndex: number;
  containerTag: string;
  metadata?: Metadata | string;
  sourceDocId: string;
};

/** Neo4j data access layer for Documents, Memories, and relations. */
export class Neo4jClient {
  private readonly driver: Driver;

  /**
   * Creates a new Neo4j client from runtime config.
   * @param config Parsed application configuration.
   */
  public constructor(config: AppConfig) {
    this.driver = neo4j.driver(
      config.NEO4J_URI,
      neo4j.auth.basic(config.NEO4J_USER, config.NEO4J_PASSWORD)
    );
  }

  /**
   * Ensures the database connection is valid.
   */
  public async verifyConnectivity(): Promise<void> {
    await this.driver.verifyConnectivity();
  }

  /**
   * Returns the underlying driver for low-level operations.
   */
  public getDriver(): Driver {
    return this.driver;
  }

  /**
   * Closes the Neo4j driver.
   */
  public async close(): Promise<void> {
    await this.driver.close();
  }

  /**
   * Creates a :Document node.
   * @param input Document fields.
   * @returns Created document.
   */
  public async createDocument(input: DocumentCreateInput): Promise<Document> {
    const session = this.driver.session();
    const now = new Date().toISOString();
    const id = uuidv4();
    try {
      const result = await session.run(
        ` CREATE (d:Document {
            id: $id,
            title: $title,
            contentType: $contentType,
            rawContent: $rawContent,
            sourceUrl: $sourceUrl,
            filePath: $filePath,
            containerTag: $containerTag,
            metadata: $metadata,
            status: $status,
            createdAt: datetime($createdAt),
            updatedAt: datetime($updatedAt)
          })
          RETURN d `,
        {
          id,
          title: input.title,
          contentType: input.contentType,
          rawContent: input.rawContent,
          sourceUrl: input.sourceUrl ?? null,
          filePath: input.filePath ?? null,
          containerTag: input.containerTag,
          metadata: input.metadata
            ? typeof input.metadata === "string"
              ? input.metadata
              : JSON.stringify(input.metadata)
            : "{}",
          status: DocumentStatus.Queued,
          createdAt: now,
          updatedAt: now,
        }
      );
      return this.mapDocument(result.records[0]?.get("d"));
    } finally {
      await session.close();
    }
  }

  /**
   * Returns a document by id.
   * @param documentId Document identifier.
   */
  public async getDocument(documentId: string): Promise<Document | null> {
    const session = this.driver.session();
    try {
      const result = await session.run(
        "MATCH (d:Document {id: $id}) RETURN d LIMIT 1",
        { id: documentId }
      );
      if (result.records.length === 0) {
        return null;
      }
      return this.mapDocument(result.records[0]?.get("d"));
    } finally {
      await session.close();
    }
  }

  /**
   * Lists documents filtered by container tag and optional status.
   * Excludes rawContent from the returned documents to reduce payload size.
   * @param params Listing filters.
   */
  public async listDocuments(params: {
    containerTag?: string;
    status?: DocumentStatus;
    limit?: number;
  }): Promise<Document[]> {
    const session = this.driver.session();
    try {
      const result = await session.run(
        ` MATCH (d:Document)
          WHERE ($containerTag IS NULL OR d.containerTag = $containerTag)
          AND ($status IS NULL OR d.status = $status)
          RETURN d { .* - rawContent } as d
          ORDER BY d.createdAt DESC
          LIMIT $limit `,
        {
          containerTag: params.containerTag ?? null,
          status: params.status ?? null,
          limit: neo4j.int(params.limit ?? 50),
        }
      );
      return result.records.map((record) => this.mapDocument(record.get("d")));
    } finally {
      await session.close();
    }
  }

  /**
   * Maps a Neo4j node or record to a Document object.
   * Handles both full Node objects and map projections.
   * @param node Neo4j node or record.
   */
  private mapDocument(node: any): Document {
    if (!node) {
      throw new Error("Cannot map null document node");
    }

    // Handle both Neo4j Node (with properties) and Map projection (plain object)
    const props = node.properties || node;

    return {
      id: props.id,
      title: props.title,
      contentType: props.contentType,
      rawContent: props.rawContent ?? null,
      sourceUrl: props.sourceUrl ?? null,
      filePath: props.filePath ?? null,
      containerTag: props.containerTag,
      metadata:
        typeof props.metadata === "string"
          ? JSON.parse(props.metadata)
          : props.metadata || {},
      status: props.status,
      createdAt:
        props.createdAt instanceof Date
          ? props.createdAt.toISOString()
          : props.createdAt,
      updatedAt:
        props.updatedAt instanceof Date
          ? props.updatedAt.toISOString()
          : props.updatedAt,
    } as Document;
  }

  // Additional methods for memories, chunks, relations, etc. would follow here...
  // (truncated in original source)
}
