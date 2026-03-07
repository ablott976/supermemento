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

/** Constant for limiting latest memories retrieval */
const LIMIT_LATEST_MEMORIES = 100;

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
        `
        CREATE (d:Document {
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
        RETURN d
        `,
        {
          id,
          title: input.title,
          contentType: input.contentType,
          rawContent: input.rawContent,
          sourceUrl: input.sourceUrl ?? null,
          filePath: input.filePath ?? null,
          containerTag: input.containerTag,
          metadata: input.metadata ? JSON.stringify(input.metadata) : null,
          status: DocumentStatus.Pending,
          createdAt: now,
          updatedAt: now,
        }
      );
      const record = result.records[0];
      const node = record.get("d");
      return {
        id: node.properties.id,
        title: node.properties.title,
        contentType: node.properties.contentType,
        rawContent: node.properties.rawContent,
        sourceUrl: node.properties.sourceUrl,
        filePath: node.properties.filePath,
        containerTag: node.properties.containerTag,
        metadata: node.properties.metadata ? JSON.parse(node.properties.metadata) : {},
        status: node.properties.status,
        createdAt: node.properties.createdAt.toString(),
        updatedAt: node.properties.updatedAt.toString(),
      } as Document;
    } finally {
      await session.close();
    }
  }

  /**
   * Retrieves the latest memories for a specific container.
   * @param containerTag The container tag to filter memories by.
   * @param page 1-indexed page number (default: 1).
   * @param pageSize Maximum number of memories per page (default: LIMIT_LATEST_MEMORIES).
   * @returns Array of memories ordered by creation date (newest first).
   */
  public async getLatestMemoriesByContainer(
    containerTag: string,
    page: number = 1,
    pageSize: number = LIMIT_LATEST_MEMORIES
  ): Promise<Memory[]> {
    const session = this.driver.session();
    const boundedPage = Math.max(1, Math.floor(page));
    const boundedPageSize = Math.max(1, Math.floor(pageSize));
    const skip = (boundedPage - 1) * boundedPageSize;
    try {
      const result = await session.run(
        `
        MATCH (m:Memory {containerTag: $containerTag})
        WHERE m.isLatest = true OR m.isLatest IS NULL
        RETURN m
        ORDER BY m.createdAt DESC
        SKIP $skip
        LIMIT $limit
        `,
        {
          containerTag,
          skip: neo4j.int(skip),
          limit: neo4j.int(boundedPageSize),
        }
      );

      return result.records.map((record) => {
        const node = record.get("m");
        const props = node.properties;
        return {
          id: props.id,
          content: props.content,
          memoryType: props.memoryType,
          containerTag: props.containerTag,
          confidence: props.confidence,
          sourceDocId: props.sourceDocId,
          isLatest: props.isLatest ?? true,
          validFrom: props.validFrom,
          validTo: props.validTo,
          createdAt: props.createdAt?.toString(),
          updatedAt: props.updatedAt?.toString(),
          forgottenAt: props.forgottenAt,
          embedding: props.embedding,
        } as Memory;
      });
    } finally {
      await session.close();
    }
  }
}

export const set_container_config = jest.fn();
export const getContainerFilterPrompt = jest.fn();
export const getLatestMemoriesByContainer = jest.fn();
