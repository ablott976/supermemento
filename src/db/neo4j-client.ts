import neo4j, { Driver, Integer } from "neo4j-driver";
import { v4 as uuidv4 } from "uuid";
import type { AppConfig } from "../config.js";
import { DocumentStatus, MemoryType, RelationType } from "../types/enums.js";
import type {
  Document,
  Memory,
  MemoryRelation,
  MemorySearchHit,
  Metadata
} from "../types/models.js";

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
  metadata?: Metadata;
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
          metadata: input.metadata ?? {},
          status: DocumentStatus.Queued,
          createdAt: now,
          updatedAt: now
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
        RETURN d
        ORDER BY d.createdAt DESC
        LIMIT $limit
        `,
        {
          containerTag: params.containerTag ?? null,
          status: params.status ?? null,
          limit: neo4j.int(params.limit ?? 50)
        }
      );

      return result.records.map((record) => this.mapDocument(record.get("d")));
    } finally {
      await session.close();
    }
  }

  /**
   * Updates mutable document fields.
   * @param documentId Document identifier.
   * @param input Partial document payload.
   */
  public async updateDocument(
    documentId: string,
    input: DocumentUpdateInput
  ): Promise<Document | null> {
    const session = this.driver.session();
    try {
      const result = await session.run(
        `
        MATCH (d:Document {id: $id})
        SET d.title = COALESCE($title, d.title),
            d.rawContent = COALESCE($rawContent, d.rawContent),
            d.metadata = COALESCE($metadata, d.metadata),
            d.status = COALESCE($status, d.status),
            d.updatedAt = datetime($updatedAt)
        RETURN d
        `,
        {
          id: documentId,
          title: input.title ?? null,
          rawContent: input.rawContent ?? null,
          metadata: input.metadata ?? null,
          status: input.status ?? null,
          updatedAt: new Date().toISOString()
        }
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
   * Deletes a document and returns true if it existed.
   * @param documentId Document identifier.
   */
  public async deleteDocument(documentId: string): Promise<boolean> {
    const session = this.driver.session();
    try {
      const result = await session.run(
        "MATCH (d:Document {id: $id}) DETACH DELETE d RETURN count(d) AS deletedCount",
        { id: documentId }
      );
      return Number(result.records[0]?.get("deletedCount") ?? 0) > 0;
    } finally {
      await session.close();
    }
  }

  /**
   * Creates a :Memory node and its EXTRACTED_FROM relation.
   * @param input Memory payload.
   */
  public async createMemory(input: MemoryCreateInput): Promise<Memory> {
    const session = this.driver.session();
    const id = uuidv4();
    const now = new Date().toISOString();

    try {
      const result = await session.run(
        `
        MATCH (d:Document {id: $sourceDocId})
        CREATE (m:Memory {
          id: $id,
          content: $content,
          memoryType: $memoryType,
          containerTag: $containerTag,
          isLatest: true,
          confidence: $confidence,
          embedding: $embedding,
          validFrom: CASE WHEN $validFrom IS NULL THEN NULL ELSE datetime($validFrom) END,
          validTo: CASE WHEN $validTo IS NULL THEN NULL ELSE datetime($validTo) END,
          forgottenAt: NULL,
          createdAt: datetime($createdAt),
          sourceDocId: $sourceDocId
        })
        CREATE (m)-[:EXTRACTED_FROM]->(d)
        RETURN m
        `,
        {
          id,
          content: input.content,
          memoryType: input.memoryType,
          containerTag: input.containerTag,
          confidence: input.confidence,
          embedding: input.embedding,
          validFrom: input.validFrom ?? null,
          validTo: input.validTo ?? null,
          createdAt: now,
          sourceDocId: input.sourceDocId
        }
      );

      if (result.records.length === 0) {
        throw new Error(`Document ${input.sourceDocId} not found; cannot create memory`);
      }

      return this.mapMemory(result.records[0]?.get("m"));
    } finally {
      await session.close();
    }
  }

  /**
   * Creates a derived memory and DERIVES links to each source memory.
   * @param params Derived memory payload.
   */
  public async createDerivedMemory(params: {
    content: string;
    containerTag: string;
    sourceDocId: string;
    sourceMemoryIds: string[];
    embedding: number[];
  }): Promise<Memory> {
    const session = this.driver.session();
    const id = uuidv4();
    const now = new Date().toISOString();

    try {
      const result = await session.executeWrite((tx) =>
        tx.run(
          `
          MATCH (d:Document {id: $sourceDocId})
          CREATE (derived:Memory {
            id: $id,
            content: $content,
            memoryType: $memoryType,
            containerTag: $containerTag,
            isLatest: true,
            confidence: 0.6,
            embedding: $embedding,
            validFrom: NULL,
            validTo: NULL,
            forgottenAt: NULL,
            createdAt: datetime($createdAt),
            sourceDocId: $sourceDocId
          })
          CREATE (derived)-[:EXTRACTED_FROM]->(d)
          WITH derived
          UNWIND $sourceMemoryIds AS sourceId
          MATCH (source:Memory {id: sourceId})
          CREATE (derived)-[:DERIVES]->(source)
          RETURN derived
          LIMIT 1
          `,
          {
            id,
            content: params.content,
            memoryType: MemoryType.Derived,
            containerTag: params.containerTag,
            sourceDocId: params.sourceDocId,
            sourceMemoryIds: params.sourceMemoryIds,
            createdAt: now,
            embedding: params.embedding
          }
        )
      );

      if (result.records.length === 0) {
        throw new Error("Failed to create derived memory");
      }

      return this.mapMemory(result.records[0]?.get("derived"));
    } finally {
      await session.close();
    }
  }

  /**
   * Retrieves a memory by id.
   * @param memoryId Memory identifier.
   */
  public async getMemory(memoryId: string): Promise<Memory | null> {
    const session = this.driver.session();
    try {
      const result = await session.run(
        "MATCH (m:Memory {id: $id}) RETURN m LIMIT 1",
        { id: memoryId }
      );

      if (result.records.length === 0) {
        return null;
      }

      return this.mapMemory(result.records[0]?.get("m"));
    } finally {
      await session.close();
    }
  }

  /**
   * Updates mutable memory fields.
   * @param memoryId Memory identifier.
   * @param input Partial memory payload.
   */
  public async updateMemory(memoryId: string, input: MemoryUpdateInput): Promise<Memory | null> {
    const session = this.driver.session();
    try {
      const result = await session.run(
        `
        MATCH (m:Memory {id: $id})
        SET m.content = COALESCE($content, m.content),
            m.memoryType = COALESCE($memoryType, m.memoryType),
            m.isLatest = CASE WHEN $isLatest IS NULL THEN m.isLatest ELSE $isLatest END,
            m.confidence = CASE WHEN $confidence IS NULL THEN m.confidence ELSE $confidence END,
            m.validFrom = CASE WHEN $validFrom = '__UNSET__' THEN m.validFrom WHEN $validFrom IS NULL THEN NULL ELSE datetime($validFrom) END,
            m.validTo = CASE WHEN $validTo = '__UNSET__' THEN m.validTo WHEN $validTo IS NULL THEN NULL ELSE datetime($validTo) END,
            m.forgottenAt = CASE WHEN $forgottenAt = '__UNSET__' THEN m.forgottenAt WHEN $forgottenAt IS NULL THEN NULL ELSE datetime($forgottenAt) END
        RETURN m
        `,
        {
          id: memoryId,
          content: input.content ?? null,
          memoryType: input.memoryType ?? null,
          isLatest: typeof input.isLatest === "boolean" ? input.isLatest : null,
          confidence: typeof input.confidence === "number" ? input.confidence : null,
          validFrom: input.validFrom === undefined ? "__UNSET__" : input.validFrom,
          validTo: input.validTo === undefined ? "__UNSET__" : input.validTo,
          forgottenAt: input.forgottenAt === undefined ? "__UNSET__" : input.forgottenAt
        }
      );

      if (result.records.length === 0) {
        return null;
      }

      return this.mapMemory(result.records[0]?.get("m"));
    } finally {
      await session.close();
    }
  }

  /**
   * Deletes a memory and returns true if it existed.
   * @param memoryId Memory identifier.
   */
  public async deleteMemory(memoryId: string): Promise<boolean> {
    const session = this.driver.session();
    try {
      const result = await session.run(
        "MATCH (m:Memory {id: $id}) DETACH DELETE m RETURN count(m) AS deletedCount",
        { id: memoryId }
      );
      return Number(result.records[0]?.get("deletedCount") ?? 0) > 0;
    } finally {
      await session.close();
    }
  }

  /**
   * Lists memories with optional filters.
   * @param params Query filters.
   */
  public async listMemories(params: {
    containerTag?: string;
    memoryType?: MemoryType;
    isLatest?: boolean;
    limit?: number;
  }): Promise<Memory[]> {
    const session = this.driver.session();
    try {
      const result = await session.run(
        `
        MATCH (m:Memory)
        WHERE ($containerTag IS NULL OR m.containerTag = $containerTag)
          AND ($memoryType IS NULL OR m.memoryType = $memoryType)
          AND ($isLatest IS NULL OR m.isLatest = $isLatest)
        RETURN m
        ORDER BY m.createdAt DESC
        LIMIT $limit
        `,
        {
          containerTag: params.containerTag ?? null,
          memoryType: params.memoryType ?? null,
          isLatest: typeof params.isLatest === "boolean" ? params.isLatest : null,
          limit: neo4j.int(params.limit ?? 50)
        }
      );

      return result.records.map((record) => this.mapMemory(record.get("m")));
    } finally {
      await session.close();
    }
  }

  /**
   * Performs vector search over memories and returns scored hits.
   * @param params Search parameters.
   */
  public async semanticSearchMemories(params: {
    embedding: number[];
    containerTag?: string;
    minScore?: number;
    limit?: number;
    isLatestOnly?: boolean;
  }): Promise<MemorySearchHit[]> {
    const session = this.driver.session();
    const limit = params.limit ?? 10;

    try {
      const result = await session.run(
        `
        CALL db.index.vector.queryNodes('memory_embeddings', $limit, $embedding)
        YIELD node, score
        WHERE ($containerTag IS NULL OR node.containerTag = $containerTag)
          AND ($isLatestOnly = false OR node.isLatest = true)
          AND score >= $minScore
        RETURN node, score
        ORDER BY score DESC
        `,
        {
          limit: neo4j.int(limit),
          embedding: params.embedding,
          containerTag: params.containerTag ?? null,
          minScore: params.minScore ?? 0,
          isLatestOnly: params.isLatestOnly ?? false
        }
      );

      return result.records.map((record) => ({
        memory: this.mapMemory(record.get("node")),
        score: Number(record.get("score"))
      }));
    } finally {
      await session.close();
    }
  }

  /**
   * Creates a relation between two memories.
   * @param fromMemoryId Source memory id.
   * @param toMemoryId Target memory id.
   * @param relationType Neo4j relation type.
   */
  public async createMemoryRelation(
    fromMemoryId: string,
    toMemoryId: string,
    relationType: RelationType
  ): Promise<void> {
    if (
      relationType !== RelationType.Updates &&
      relationType !== RelationType.Extends &&
      relationType !== RelationType.Derives
    ) {
      throw new Error(`Unsupported memory-to-memory relation type: ${relationType}`);
    }

    const session = this.driver.session();
    try {
      await session.run(
        `
        MATCH (from:Memory {id: $fromMemoryId})
        MATCH (to:Memory {id: $toMemoryId})
        MERGE (from)-[r:${relationType}]->(to)
        RETURN r
        `,
        { fromMemoryId, toMemoryId }
      );
    } finally {
      await session.close();
    }
  }

  /**
   * Marks a memory as no longer current.
   * @param memoryId Memory identifier.
   */
  public async markMemoryNotLatest(memoryId: string): Promise<void> {
    const session = this.driver.session();
    try {
      await session.run(
        "MATCH (m:Memory {id: $id}) SET m.isLatest = false RETURN m",
        { id: memoryId }
      );
    } finally {
      await session.close();
    }
  }

  /**
   * Fetches incoming and outgoing relations for a memory.
   * @param memoryId Memory identifier.
   */
  public async getMemoryRelations(memoryId: string): Promise<MemoryRelation[]> {
    const session = this.driver.session();
    try {
      const result = await session.run(
        `
        MATCH (a:Memory)-[r]->(b:Memory)
        WHERE a.id = $id OR b.id = $id
        RETURN a.id AS fromMemoryId, b.id AS toMemoryId, type(r) AS relationType
        ORDER BY relationType
        `,
        { id: memoryId }
      );

      return result.records.map((record) => ({
        fromMemoryId: String(record.get("fromMemoryId")),
        toMemoryId: String(record.get("toMemoryId")),
        relationType: String(record.get("relationType"))
      }));
    } finally {
      await session.close();
    }
  }

  private mapDocument(nodeValue: unknown): Document {
    const props = this.nodeProps(nodeValue);
    return {
      id: String(props.id),
      title: String(props.title),
      contentType: props.contentType as Document["contentType"],
      rawContent: String(props.rawContent),
      sourceUrl: this.nullableString(props.sourceUrl),
      filePath: this.nullableString(props.filePath),
      containerTag: String(props.containerTag),
      metadata: (props.metadata as Metadata) ?? {},
      status: props.status as DocumentStatus,
      createdAt: this.toIsoString(props.createdAt),
      updatedAt: this.toIsoString(props.updatedAt)
    };
  }

  private mapMemory(nodeValue: unknown): Memory {
    const props = this.nodeProps(nodeValue);
    return {
      id: String(props.id),
      content: String(props.content),
      memoryType: props.memoryType as MemoryType,
      containerTag: String(props.containerTag),
      isLatest: Boolean(props.isLatest),
      confidence: Number(props.confidence),
      embedding: (props.embedding as number[]) ?? [],
      validFrom: this.toNullableIsoString(props.validFrom),
      validTo: this.toNullableIsoString(props.validTo),
      forgottenAt: this.toNullableIsoString(props.forgottenAt),
      createdAt: this.toIsoString(props.createdAt),
      sourceDocId: String(props.sourceDocId)
    };
  }

  private nodeProps(value: unknown): Record<string, unknown> {
    if (typeof value === "object" && value !== null && "properties" in value) {
      return this.coerceRecord((value as { properties: Record<string, unknown> }).properties);
    }
    throw new Error("Unexpected Neo4j node value");
  }

  private coerceRecord(record: Record<string, unknown>): Record<string, unknown> {
    const coerced: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
      coerced[key] = this.coerceValue(value);
    }
    return coerced;
  }

  private coerceValue(value: unknown): unknown {
    if (neo4j.isInt(value)) {
      return (value as Integer).toNumber();
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.coerceValue(item));
    }

    if (typeof value === "object" && value !== null && "toString" in value) {
      const maybeTemporal = value as { toString: () => string };
      if (
        "year" in (value as object) ||
        "month" in (value as object) ||
        "day" in (value as object)
      ) {
        return maybeTemporal.toString();
      }
    }

    return value;
  }

  private nullableString(value: unknown): string | null {
    if (value === null || value === undefined) {
      return null;
    }
    return String(value);
  }

  private toIsoString(value: unknown): string {
    if (typeof value === "string") {
      return new Date(value).toISOString();
    }
    return new Date(String(value)).toISOString();
  }

  private toNullableIsoString(value: unknown): string | null {
    if (value === null || value === undefined) {
      return null;
    }
    return this.toIsoString(value);
  }
}
