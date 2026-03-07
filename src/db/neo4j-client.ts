import neo4j, { Driver } from "neo4j-driver";
import { v4 as uuidv4 } from "uuid";
import type { AppConfig } from "../config.js";
import { DocumentStatus, MemoryType } from "../types/enums.js";
import type { Document, Memory, Metadata } from "../types/models.js";

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
        `
          MATCH (d:Document)
          WHERE ($containerTag IS NULL OR d.containerTag = $containerTag)
            AND ($status IS NULL OR d.status = $status)
          RETURN d {
            .id,
            .title,
            .contentType,
            .sourceUrl,
            .filePath,
            .containerTag,
            .metadata,
            .status,
            .createdAt,
            .updatedAt
          } as d
          ORDER BY d.createdAt DESC
          LIMIT $limit
        `,
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
   * Maps a Neo4j record to a Document type.
   * Handles both Node objects (with .properties) and projected maps from RETURN clauses.
   * @param record Neo4j record, node, or projection.
   * @returns Document object or null if input is null.
   */
  private mapDocument(record: any): Document | null {
    if (!record) {
      return null;
    }

    // Handle both Node objects (with .properties) and projected maps (like in listDocuments)
    const props = record.properties || record;

    // Convert Neo4j DateTime objects to ISO strings
    const toISOString = (dateValue: any): string => {
      if (!dateValue) return dateValue;
      if (typeof dateValue === "string") return dateValue;
      // Neo4j DateTime objects have toString() method
      if (dateValue.toString && typeof dateValue.toString === "function") {
        return dateValue.toString();
      }
      return dateValue;
    };

    // Parse metadata if it's a string (stored as JSON string in Neo4j)
    let metadata: Metadata = {};
    if (props.metadata) {
      if (typeof props.metadata === "string") {
        try {
          metadata = JSON.parse(props.metadata);
        } catch {
          metadata = {};
        }
      } else if (typeof props.metadata === "object") {
        metadata = props.metadata;
      }
    }

    return {
      id: props.id,
      title: props.title,
      contentType: props.contentType,
      rawContent: props.rawContent || "",
      sourceUrl: props.sourceUrl ?? null,
      filePath: props.filePath ?? null,
      containerTag: props.containerTag,
      metadata,
      status: props.status,
      createdAt: toISOString(props.createdAt),
      updatedAt: toISOString(props.updatedAt),
    };
  }

  /**
   * Updates a document by id.
   * @param documentId Document identifier.
   * @param input Update fields.
   * @returns Updated document or null if not found.
   */
  public async updateDocument(
    documentId: string,
    input: DocumentUpdateInput
  ): Promise<Document | null> {
    const session = this.driver.session();
    const now = new Date().toISOString();
    try {
      const setClauses: string[] = ["d.updatedAt = datetime($updatedAt)"];
      const params: Record<string, any> = {
        id: documentId,
        updatedAt: now,
      };

      if (input.title !== undefined) {
        setClauses.push("d.title = $title");
        params.title = input.title;
      }
      if (input.rawContent !== undefined) {
        setClauses.push("d.rawContent = $rawContent");
        params.rawContent = input.rawContent;
      }
      if (input.status !== undefined) {
        setClauses.push("d.status = $status");
        params.status = input.status;
      }
      if (input.metadata !== undefined) {
        setClauses.push("d.metadata = $metadata");
        params.metadata =
          typeof input.metadata === "string"
            ? input.metadata
            : JSON.stringify(input.metadata);
      }

      const result = await session.run(
        `
          MATCH (d:Document {id: $id})
          SET ${setClauses.join(", ")}
          RETURN d
        `,
        params
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
   * Deletes a document by id.
   * @param documentId Document identifier.
   * @returns True if deleted, false if not found.
   */
  public async deleteDocument(documentId: string): Promise<boolean> {
    const session = this.driver.session();
    try {
      const result = await session.run(
        `
          MATCH (d:Document {id: $id})
          DETACH DELETE d
          RETURN count(d) as deleted
        `,
        { id: documentId }
      );
      return result.records[0]?.get("deleted").toInt() > 0;
    } finally {
      await session.close();
    }
  }

  /**
   * Creates a :Memory node linked to a source document.
   * @param input Memory fields.
   * @returns Created memory.
   */
  public async createMemory(input: MemoryCreateInput): Promise<Memory> {
    const session = this.driver.session();
    const now = new Date().toISOString();
    const id = uuidv4();
    try {
      const result = await session.run(
        `
          MATCH (d:Document {id: $sourceDocId})
          CREATE (m:Memory {
            id: $id,
            content: $content,
            memoryType: $memoryType,
            containerTag: $containerTag,
            confidence: $confidence,
            embedding: $embedding,
            isLatest: true,
            validFrom: datetime($validFrom),
            validTo: datetime($validTo),
            createdAt: datetime($createdAt),
            updatedAt: datetime($updatedAt)
          })-[:DERIVED_FROM]->(d)
          RETURN m
        `,
        {
          id,
          content: input.content,
          memoryType: input.memoryType,
          containerTag: input.containerTag,
          confidence: input.confidence,
          embedding: input.embedding,
          sourceDocId: input.sourceDocId,
          validFrom: input.validFrom ?? now,
          validTo: input.validTo ?? null,
          createdAt: now,
          updatedAt: now,
        }
      );
      return this.mapMemory(result.records[0]?.get("m"));
    } finally {
      await session.close();
    }
  }

  /**
   * Maps a Neo4j record to a Memory type.
   * Handles both Node objects and projected maps.
   * @param record Neo4j record, node, or projection.
   * @returns Memory object or null if input is null.
   */
  private mapMemory(record: any): Memory | null {
    if (!record) {
      return null;
    }

    const props = record.properties || record;

    const toISOString = (dateValue: any): string | null => {
      if (!dateValue) return null;
      if (typeof dateValue === "string") return dateValue;
      if (dateValue.toString && typeof dateValue.toString === "function") {
        return dateValue.toString();
      }
      return null;
    };

    return {
      id: props.id,
      content: props.content,
      memoryType: props.memoryType,
      containerTag: props.containerTag,
      confidence: props.confidence,
      embedding: props.embedding || [],
      isLatest: props.isLatest ?? true,
      validFrom: toISOString(props.validFrom),
      validTo: toISOString(props.validTo),
      forgottenAt: toISOString(props.forgottenAt),
      createdAt: toISOString(props.createdAt),
      updatedAt: toISOString(props.updatedAt),
    };
  }
}
