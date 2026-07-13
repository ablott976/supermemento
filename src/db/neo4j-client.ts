import neo4j, { Driver, Integer } from "neo4j-driver";
import { v4 as uuidv4, v5 as uuidv5 } from "uuid";
import type { AppConfig } from "../config.js";
import { DocumentStatus, MemoryType, RelationType } from "../types/enums.js";
import type {
  Chunk,
  ChunkSearchHit,
  Document,
  Memory,
  MemoryRelation,
  MemorySearchHit,
  Metadata,
  Profile
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

const DERIVED_MEMORY_ID_NAMESPACE = "6f95d7ad-e62f-4c43-b74a-b722f8394d97";

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
          metadata: input.metadata ? (typeof input.metadata === "string" ? input.metadata : JSON.stringify(input.metadata)) : "{}",
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
          metadata: input.metadata != null
            ? (typeof input.metadata === "string" ? input.metadata : JSON.stringify(input.metadata))
            : null,
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
   * Removes generated artifacts before safely reprocessing an existing document.
   * Refuses to continue when extracted memories already exist.
   * @param documentId Document identifier.
   */
  public async prepareDocumentForReprocessing(
    documentId: string,
    repairId: string
  ): Promise<{
    document: Document;
    deletedChunkCount: number;
    deletedMemoryCount: number;
  }> {
    const session = this.driver.session();
    try {
      return await session.executeWrite(async (tx) => {
        const now = new Date();
        const check = await tx.run(
          `
          MATCH (d:Document {id: $documentId})
          SET d.repairLockVersion = coalesce(d.repairLockVersion, 0) + 1
          RETURN d.repairRunId AS existingRepairId,
                 d.repairLeaseUntil AS repairLeaseUntil
          `,
          { documentId }
        );
        if (check.records.length === 0) {
          throw new Error(`Document not found: ${documentId}`);
        }

        const existingRepairId = check.records[0]?.get("existingRepairId");
        const leaseValue = check.records[0]?.get("repairLeaseUntil");
        if (existingRepairId && String(existingRepairId) !== repairId) {
          throw new Error(
            `Refusing to reprocess document ${documentId}: another repair run owns it`
          );
        }
        if (
          existingRepairId &&
          leaseValue &&
          new Date(String(leaseValue)).getTime() > now.getTime()
        ) {
          throw new Error(`Refusing to reprocess document ${documentId}: repair lease is active`);
        }

        const memoryCountResult = await tx.run(
          `
          MATCH (d:Document {id: $documentId})
          OPTIONAL MATCH (m:Memory)-[:EXTRACTED_FROM]->(d)
          RETURN count(m) AS memoryCount
          `,
          { documentId }
        );
        const memoryCount = Number(memoryCountResult.records[0]?.get("memoryCount") ?? 0);
        if (!existingRepairId && memoryCount > 0) {
          throw new Error(
            `Refusing to start repair for document ${documentId}: ${memoryCount} extracted memories already exist`
          );
        }

        await tx.run(
          `
          MATCH (d:Document {id: $documentId})
          MATCH (m:Memory)-[:EXTRACTED_FROM]->(d)
          MATCH (m)-[:EXTENDS]->(target:Memory)
          MERGE (d)-[:REPAIR_EXTENDS]->(target)
          `,
          { documentId }
        );
        const memoryCleanup = await tx.run(
          `
          MATCH (m:Memory)-[:EXTRACTED_FROM]->(:Document {id: $documentId})
          DETACH DELETE m
          `,
          { documentId }
        );
        const chunkCleanup = await tx.run(
          `
          MATCH (c:Chunk)-[:EXTRACTED_FROM]->(:Document {id: $documentId})
          DETACH DELETE c
          `,
          { documentId }
        );

        const leaseUntil = new Date(now.getTime() + 30 * 60 * 1000).toISOString();
        const claim = await tx.run(
          `
          MATCH (d:Document {id: $documentId})
          SET d.repairRunId = $repairId,
              d.repairLeaseUntil = datetime($leaseUntil),
              d.status = $extractingStatus,
              d.updatedAt = datetime($updatedAt)
          RETURN d
          `,
          {
            documentId,
            repairId,
            leaseUntil,
            extractingStatus: DocumentStatus.Extracting,
            updatedAt: new Date().toISOString()
          }
        );

        return {
          document: this.mapDocument(claim.records[0]?.get("d")),
          deletedChunkCount: chunkCleanup.summary.counters.updates().nodesDeleted,
          deletedMemoryCount: memoryCleanup.summary.counters.updates().nodesDeleted
        };
      });
    } finally {
      await session.close();
    }
  }

  /** Clears a successful document repair claim. */
  public async completeDocumentReprocessing(documentId: string, repairId: string): Promise<void> {
    const session = this.driver.session();
    try {
      const result = await session.run(
        `
        MATCH (d:Document {id: $documentId, repairRunId: $repairId})
        OPTIONAL MATCH (d)-[preserved:REPAIR_EXTENDS]->(:Memory)
        DELETE preserved
        REMOVE d.repairRunId, d.repairLeaseUntil, d.repairLockVersion
        SET d.updatedAt = datetime($updatedAt)
        RETURN DISTINCT d
        `,
        { documentId, repairId, updatedAt: new Date().toISOString() }
      );
      if (result.records.length === 0) {
        throw new Error(`Repair claim not found for document ${documentId}`);
      }
    } finally {
      await session.close();
    }
  }

  /** Releases a failed repair lease while retaining its retry ownership. */
  public async releaseDocumentReprocessing(documentId: string, repairId: string): Promise<void> {
    const session = this.driver.session();
    try {
      await session.run(
        `
        MATCH (d:Document {id: $documentId, repairRunId: $repairId})
        SET d.repairLeaseUntil = datetime(),
            d.updatedAt = datetime()
        RETURN d
        `,
        { documentId, repairId }
      );
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
          originalConfidence: NULL,
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
   * Creates many memories in a single write transaction using UNWIND.
   * All memories must share the same sourceDocId.
   * @param inputs Memory payloads.
   */
  public async batchCreateMemories(inputs: MemoryCreateInput[]): Promise<Memory[]> {
    if (inputs.length === 0) {
      return [];
    }

    const now = new Date().toISOString();
    const rows = inputs.map((input) => ({
      id: uuidv4(),
      content: input.content,
      memoryType: input.memoryType,
      containerTag: input.containerTag,
      confidence: input.confidence,
      embedding: input.embedding,
      validFrom: input.validFrom ?? null,
      validTo: input.validTo ?? null,
      createdAt: now,
      sourceDocId: input.sourceDocId
    }));

    const session = this.driver.session();
    try {
      const result = await session.run(
        `
        UNWIND $rows AS row
        MATCH (d:Document {id: row.sourceDocId})
        CREATE (m:Memory {
          id: row.id,
          content: row.content,
          memoryType: row.memoryType,
          containerTag: row.containerTag,
          isLatest: true,
          confidence: row.confidence,
          originalConfidence: NULL,
          embedding: row.embedding,
          validFrom: CASE WHEN row.validFrom IS NULL THEN NULL ELSE datetime(row.validFrom) END,
          validTo: CASE WHEN row.validTo IS NULL THEN NULL ELSE datetime(row.validTo) END,
          forgottenAt: NULL,
          createdAt: datetime(row.createdAt),
          sourceDocId: row.sourceDocId
        })
        CREATE (m)-[:EXTRACTED_FROM]->(d)
        RETURN m
        `,
        { rows }
      );

      return result.records.map((record) => this.mapMemory(record.get("m")));
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
    const sourceMemoryIds = [...new Set(params.sourceMemoryIds)].sort();
    const id = uuidv5(
      JSON.stringify({
        content: params.content,
        containerTag: params.containerTag,
        sourceDocId: params.sourceDocId,
        sourceMemoryIds
      }),
      DERIVED_MEMORY_ID_NAMESPACE
    );
    const now = new Date().toISOString();

    try {
      const result = await session.executeWrite(async (tx) => {
        const existingResult = await tx.run(
          `
          MATCH (derived:Memory {
            memoryType: $memoryType,
            containerTag: $containerTag,
            sourceDocId: $sourceDocId,
            content: $content
          })-[:DERIVES]->(source:Memory)
          WITH derived, collect(DISTINCT source.id) AS existingSourceIds
          WHERE size(existingSourceIds) = size($sourceMemoryIds)
            AND all(sourceId IN $sourceMemoryIds WHERE sourceId IN existingSourceIds)
          RETURN derived
          LIMIT 1
          `,
          {
            content: params.content,
            memoryType: MemoryType.Derived,
            containerTag: params.containerTag,
            sourceDocId: params.sourceDocId,
            sourceMemoryIds
          }
        );
        if (existingResult.records.length > 0) {
          return existingResult;
        }

        return tx.run(
          `
          MATCH (d:Document {id: $sourceDocId})
          MATCH (source:Memory)
          WHERE source.id IN $sourceMemoryIds
          WITH d, collect(DISTINCT source) AS sources
          WHERE size(sources) = size($sourceMemoryIds)
          MERGE (derived:Memory {id: $id})
          ON CREATE SET derived.content = $content,
                        derived.memoryType = $memoryType,
                        derived.containerTag = $containerTag,
                        derived.isLatest = true,
                        derived.confidence = 0.6,
                        derived.originalConfidence = NULL,
                        derived.embedding = $embedding,
                        derived.validFrom = NULL,
                        derived.validTo = NULL,
                        derived.forgottenAt = NULL,
                        derived.createdAt = datetime($createdAt),
                        derived.sourceDocId = $sourceDocId
          MERGE (derived)-[:EXTRACTED_FROM]->(d)
          FOREACH (source IN sources | MERGE (derived)-[:DERIVES]->(source))
          RETURN derived
          LIMIT 1
          `,
          {
            id,
            content: params.content,
            memoryType: MemoryType.Derived,
            containerTag: params.containerTag,
            sourceDocId: params.sourceDocId,
            sourceMemoryIds,
            createdAt: now,
            embedding: params.embedding
          }
        );
      });

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
          AND ($isLatest IS NULL OR m.isLatest = $isLatest)
          AND ($memoryType IS NULL OR m.memoryType = $memoryType)
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
    asOf?: string;
  }): Promise<MemorySearchHit[]> {
    const session = this.driver.session();
    const limit = params.limit ?? 10;
    // Historical and container filters run after the vector index ranks nodes.
    // Start with an overfetch and, for historical repair, expand only as needed
    // until enough valid hits are found or every indexed memory was considered.
    let vectorLimit = params.containerTag || params.asOf ? limit * 10 : limit;
    let maximumVectorLimit = vectorLimit;

    try {
      if (params.asOf) {
        const countResult = await session.run(
          "MATCH (node:Memory) WHERE node.embedding IS NOT NULL RETURN count(node) AS count"
        );
        const countValue = countResult.records[0]?.get("count");
        const indexedMemoryCount = neo4j.isInt(countValue)
          ? countValue.toNumber()
          : Number(countValue ?? 0);
        if (Number.isFinite(indexedMemoryCount)) {
          maximumVectorLimit = Math.max(vectorLimit, indexedMemoryCount);
        }
      }

      const runSearch = () => session.run(
        `
        CALL db.index.vector.queryNodes('memory_embeddings', $vectorLimit, $embedding)
        YIELD node, score
        WHERE ($containerTag IS NULL OR node.containerTag = $containerTag)
          AND ($asOf IS NULL OR node.createdAt <= datetime($asOf))
          AND ($asOf IS NULL OR node.validFrom IS NULL OR node.validFrom <= datetime($asOf))
          AND (
            ($asOf IS NULL AND node.forgottenAt IS NULL)
            OR ($asOf IS NOT NULL AND (node.forgottenAt IS NULL OR node.forgottenAt > datetime($asOf)))
          )
          AND (
            ($asOf IS NULL AND (node.validTo IS NULL OR node.validTo >= datetime()))
            OR ($asOf IS NOT NULL AND (node.validTo IS NULL OR node.validTo >= datetime($asOf)))
          )
          AND (
            $isLatestOnly = false
            OR ($asOf IS NULL AND node.isLatest = true)
            OR ($asOf IS NOT NULL AND NOT EXISTS {
              MATCH (superseding:Memory)-[:UPDATES]->(node)
              WHERE superseding.createdAt <= datetime($asOf)
            })
          )
          AND score >= $minScore
        RETURN node, score
        ORDER BY score DESC
        LIMIT $limit
        `,
        {
          vectorLimit: neo4j.int(vectorLimit),
          limit: neo4j.int(limit),
          embedding: params.embedding,
          containerTag: params.containerTag ?? null,
          minScore: params.minScore ?? 0,
          isLatestOnly: params.isLatestOnly ?? false,
          asOf: params.asOf ?? null
        }
      );

      let result = await runSearch();
      while (
        params.asOf &&
        result.records.length < limit &&
        vectorLimit < maximumVectorLimit
      ) {
        vectorLimit = Math.min(maximumVectorLimit, vectorLimit * 2);
        result = await runSearch();
      }

      return result.records.map((record) => ({
        memory: this.mapMemory(record.get("node")),
        score: Number(record.get("score"))
      }));
    } finally {
      await session.close();
    }
  }

  /**
   * Performs vector search over memories with advanced filters.
   * @param params Search parameters.
   */
  public async semanticSearchMemoriesAdvanced(params: {
    embedding: number[];
    containerTag?: string;
    minScore?: number;
    limit?: number;
    isLatestOnly?: boolean;
    memoryTypes?: MemoryType[];
    includeExpired?: boolean;
  }): Promise<MemorySearchHit[]> {
    const session = this.driver.session();
    const limit = params.limit ?? 10;
    const memoryTypes = params.memoryTypes ?? [];
    const vectorLimit = params.containerTag ? limit * 10 : limit;

    try {
      const result = await session.run(
        `
        CALL db.index.vector.queryNodes('memory_embeddings', $vectorLimit, $embedding)
        YIELD node, score
        WHERE ($containerTag IS NULL OR node.containerTag = $containerTag)
          AND ($isLatestOnly = false OR node.isLatest = true)
          AND node.forgottenAt IS NULL
          AND ($memoryTypesEmpty = true OR node.memoryType IN $memoryTypes)
          AND ($includeExpired = true OR node.validTo IS NULL OR node.validTo >= datetime())
          AND score >= $minScore
        RETURN node, score
        ORDER BY score DESC
        LIMIT $limit
        `,
        {
          vectorLimit: neo4j.int(vectorLimit),
          limit: neo4j.int(limit),
          embedding: params.embedding,
          containerTag: params.containerTag ?? null,
          minScore: params.minScore ?? 0,
          isLatestOnly: params.isLatestOnly ?? false,
          memoryTypes,
          memoryTypesEmpty: memoryTypes.length === 0,
          includeExpired: params.includeExpired ?? false
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
   * Creates a chunk node linked to its source document.
   * @param input Chunk payload.
   */
  public async createChunk(input: ChunkCreateInput): Promise<Chunk> {
    const session = this.driver.session();
    const id = uuidv4();

    try {
      const result = await session.run(
        `
        MATCH (d:Document {id: $sourceDocId})
        CREATE (c:Chunk {
          id: $id,
          content: $content,
          embedding: $embedding,
          chunkIndex: $chunkIndex,
          containerTag: $containerTag,
          metadata: $metadata,
          sourceDocId: $sourceDocId
        })
        CREATE (c)-[:EXTRACTED_FROM]->(d)
        RETURN c
        `,
        {
          id,
          content: input.content,
          embedding: input.embedding,
          chunkIndex: input.chunkIndex,
          containerTag: input.containerTag,
          metadata: input.metadata ?? {},
          sourceDocId: input.sourceDocId
        }
      );

      if (result.records.length === 0) {
        throw new Error(`Document ${input.sourceDocId} not found; cannot create chunk`);
      }

      return this.mapChunk(result.records[0]?.get("c"));
    } finally {
      await session.close();
    }
  }

  /**
   * Creates many chunks in a single write transaction.
   * @param chunks Chunk payloads.
   */
  public async createChunks(chunks: ChunkCreateInput[]): Promise<Chunk[]> {
    if (chunks.length === 0) {
      return [];
    }

    const session = this.driver.session();
    try {
      const rows = chunks.map((chunk) => {
        const meta = chunk.metadata ?? {};
        return {
          id: uuidv4(),
          content: chunk.content,
          embedding: chunk.embedding,
          chunkIndex: chunk.chunkIndex,
          containerTag: chunk.containerTag,
          metadata: typeof meta === "string" ? meta : JSON.stringify(meta),
          sourceDocId: chunk.sourceDocId
        };
      });

      const result = await session.run(
        `
        UNWIND $rows AS row
        MATCH (d:Document {id: row.sourceDocId})
        CREATE (c:Chunk {
          id: row.id,
          content: row.content,
          embedding: row.embedding,
          chunkIndex: row.chunkIndex,
          containerTag: row.containerTag,
          metadata: row.metadata,
          sourceDocId: row.sourceDocId
        })
        CREATE (c)-[:EXTRACTED_FROM]->(d)
        RETURN c
        ORDER BY c.chunkIndex ASC
        `,
        { rows }
      );

      return result.records.map((record) => this.mapChunk(record.get("c")));
    } finally {
      await session.close();
    }
  }

  /**
   * Performs vector search over chunk nodes.
   * @param params Search parameters.
   */
  public async semanticSearchChunks(params: {
    embedding: number[];
    containerTag?: string;
    minScore?: number;
    limit?: number;
  }): Promise<ChunkSearchHit[]> {
    const session = this.driver.session();
    const limit = params.limit ?? 10;
    const vectorLimit = params.containerTag ? limit * 10 : limit;

    try {
      const result = await session.run(
        `
        CALL db.index.vector.queryNodes('chunk_embeddings', $vectorLimit, $embedding)
        YIELD node, score
        WHERE ($containerTag IS NULL OR node.containerTag = $containerTag)
          AND score >= $minScore
        RETURN node, score
        ORDER BY score DESC
        LIMIT $limit
        `,
        {
          vectorLimit: neo4j.int(vectorLimit),
          limit: neo4j.int(limit),
          embedding: params.embedding,
          containerTag: params.containerTag ?? null,
          minScore: params.minScore ?? 0
        }
      );

      return result.records.map((record) => ({
        chunk: this.mapChunk(record.get("node")),
        score: Number(record.get("score"))
      }));
    } finally {
      await session.close();
    }
  }

  /**
   * Soft-deletes expired episode memories.
   */
  public async softDeleteExpiredEpisodes(): Promise<number> {
    const session = this.driver.session();
    try {
      const result = await session.run(
        `
        MATCH (m:Memory)
        WHERE m.memoryType = $memoryType
          AND m.validTo < datetime()
          AND m.forgottenAt IS NULL
        SET m.forgottenAt = datetime()
        RETURN count(m) AS count
        `,
        { memoryType: MemoryType.Episode }
      );
      return Number(result.records[0]?.get("count") ?? 0);
    } finally {
      await session.close();
    }
  }

  /**
   * Applies confidence decay to one memory type.
   * @param memoryType Target memory type.
   * @param halfLifeDays Half-life in days.
   */
  public async applyConfidenceDecay(memoryType: MemoryType, halfLifeDays: number): Promise<{
    decayedCount: number;
    softDeletedCount: number;
  }> {
    const session = this.driver.session();
    try {
      const result = await session.run(
        `
        MATCH (m:Memory)
        WHERE m.memoryType = $memoryType
          AND m.forgottenAt IS NULL
        WITH m,
             coalesce(m.originalConfidence, m.confidence) AS baseConfidence,
             toFloat(duration.between(m.createdAt, datetime()).days) AS daysSinceCreation
        WITH m, baseConfidence, baseConfidence * (0.5 ^ (daysSinceCreation / $halfLifeDays)) AS newConfidence
        SET m.originalConfidence = coalesce(m.originalConfidence, m.confidence),
            m.confidence = newConfidence,
            m.forgottenAt = CASE WHEN newConfidence < 0.1 THEN datetime() ELSE m.forgottenAt END
        RETURN count(m) AS decayedCount,
               sum(CASE WHEN newConfidence < 0.1 THEN 1 ELSE 0 END) AS softDeletedCount
        `,
        {
          memoryType,
          halfLifeDays
        }
      );

      return {
        decayedCount: Number(result.records[0]?.get("decayedCount") ?? 0),
        softDeletedCount: Number(result.records[0]?.get("softDeletedCount") ?? 0)
      };
    } finally {
      await session.close();
    }
  }

  /**
   * Reinforces a preference memory confidence.
   * @param memoryId Memory id.
   */
  public async reinforcePreference(memoryId: string): Promise<Memory | null> {
    const session = this.driver.session();
    try {
      const result = await session.run(
        `
        MATCH (m:Memory {id: $id})
        WHERE m.memoryType = $memoryType
          AND m.forgottenAt IS NULL
        SET m.confidence = CASE
              WHEN m.confidence + 0.15 > 1.0 THEN 1.0
              ELSE m.confidence + 0.15
            END
        RETURN m
        `,
        { id: memoryId, memoryType: MemoryType.Preference }
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
   * Soft deletes a memory by id.
   * @param memoryId Memory id.
   */
  public async softDeleteMemoryById(memoryId: string): Promise<boolean> {
    const session = this.driver.session();
    try {
      const result = await session.run(
        `
        MATCH (m:Memory {id: $id})
        WHERE m.forgottenAt IS NULL
        SET m.forgottenAt = datetime()
        RETURN count(m) AS count
        `,
        { id: memoryId }
      );
      return Number(result.records[0]?.get("count") ?? 0) > 0;
    } finally {
      await session.close();
    }
  }

  /**
   * Gets latest active memories for a container.
   * @param containerTag Container tag.
   */
  public async getLatestMemoriesByContainer(containerTag: string): Promise<Memory[]> {
    const session = this.driver.session();
    try {
      const result = await session.run(
        `
        MATCH (m:Memory {containerTag: $containerTag})
        WHERE m.isLatest = true
          AND m.forgottenAt IS NULL
        RETURN m
        ORDER BY m.createdAt DESC
        `,
        { containerTag }
      );

      return result.records.map((record) => this.mapMemory(record.get("m")));
    } finally {
      await session.close();
    }
  }

  /**
   * Sets the filter prompt for a container tag.
   * @param containerTag Container tag.
   * @param filterPrompt The prompt to set, or null to unset.
   */
  public async setContainerConfig(
    containerTag: string,
    filterPrompt: string | null
  ): Promise<void> {
    const session = this.driver.session();
    try {
      await session.run(
        `
        MERGE (c:ContainerConfig {containerTag: $containerTag})
        SET c.filterPrompt = $filterPrompt
        `,
        { containerTag, filterPrompt }
      );
    } finally {
      await session.close();
    }
  }

  /**
   * Reads filter prompt configured for a container tag.
   * @param containerTag Container tag.
   */
  public async getContainerFilterPrompt(containerTag: string): Promise<string | null> {
    const session = this.driver.session();
    try {
      const result = await session.run(
        `
        MATCH (c:ContainerConfig {containerTag: $containerTag})
        RETURN c.filterPrompt AS filterPrompt
        LIMIT 1
        `,
        { containerTag }
      );
      if (result.records.length === 0) {
        return null;
      }
      return this.nullableString(result.records[0]?.get("filterPrompt"));
    } finally {
      await session.close();
    }
  }

  /**
   * Stores generated user profile for a container.
   * @param containerTag Container tag.
   * @param staticProfile Static profile section.
   * @param dynamicProfile Dynamic profile section.
   * @param generatedAt ISO datetime.
   */
  public async upsertProfile(
    containerTag: string,
    staticProfile: string,
    dynamicProfile: string,
    generatedAt: string
  ): Promise<Profile> {
    const session = this.driver.session();
    try {
      const result = await session.run(
        `
        MERGE (p:Profile {containerTag: $containerTag})
        SET p.static = $staticProfile,
            p.dynamic = $dynamicProfile,
            p.generatedAt = datetime($generatedAt)
        RETURN p
        `,
        { containerTag, staticProfile, dynamicProfile, generatedAt }
      );
      return this.mapProfile(result.records[0]?.get("p"));
    } finally {
      await session.close();
    }
  }

  /**
   * Fetches cached profile by container tag.
   * @param containerTag Container tag.
   */
  public async getProfile(containerTag: string): Promise<Profile | null> {
    const session = this.driver.session();
    try {
      const result = await session.run(
        "MATCH (p:Profile {containerTag: $containerTag}) RETURN p LIMIT 1",
        { containerTag }
      );
      if (result.records.length === 0) {
        return null;
      }
      return this.mapProfile(result.records[0]?.get("p"));
    } finally {
      await session.close();
    }
  }

  /**
   * Finds a document by source URL.
   * @param sourceUrl Source URL.
   */
  public async findDocumentBySourceUrl(sourceUrl: string): Promise<Document | null> {
    const session = this.driver.session();
    try {
      const result = await session.run(
        "MATCH (d:Document {sourceUrl: $sourceUrl}) RETURN d ORDER BY d.updatedAt DESC LIMIT 1",
        { sourceUrl }
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
   * Finds a document by content hash and container.
   * @param containerTag Container tag.
   * @param contentHash SHA256 content hash.
   */
  public async findDocumentByContentHash(
    containerTag: string,
    contentHash: string
  ): Promise<Document | null> {
    const session = this.driver.session();
    try {
      const result = await session.run(
        `
        MATCH (d:Document {containerTag: $containerTag})
        WHERE d.metadata IS NOT NULL AND d.metadata CONTAINS $contentHash
        RETURN d
        ORDER BY d.updatedAt DESC
        LIMIT 1
        `,
        { containerTag, contentHash }
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
   * Lists crawled URLs and last crawl date.
   * @param params Optional filters.
   */
  public async listCrawledUrls(params: {
    containerTag?: string;
    limit?: number;
  }): Promise<Array<{ sourceUrl: string; lastCrawledAt: string | null; documentId: string }>> {
    const session = this.driver.session();
    try {
      const result = await session.run(
        `
        MATCH (d:Document)
        WHERE d.sourceUrl IS NOT NULL
          AND ($containerTag IS NULL OR d.containerTag = $containerTag)
        RETURN d.sourceUrl AS sourceUrl,
               d.id AS documentId,
               d.updatedAt AS lastCrawledAt
        ORDER BY d.updatedAt DESC
        LIMIT $limit
        `,
        {
          containerTag: params.containerTag ?? null,
          limit: neo4j.int(params.limit ?? 100)
        }
      );

      return result.records.map((record) => ({
        sourceUrl: String(record.get("sourceUrl")),
        documentId: String(record.get("documentId")),
        lastCrawledAt: this.toNullableIsoString(record.get("lastCrawledAt"))
      }));
    } finally {
      await session.close();
    }
  }

  /**
   * Creates a relation between two memories and applies its target-side effect atomically.
   * @param fromMemoryId Source memory id.
   * @param toMemoryId Target memory id.
   * @param relationType Neo4j relation type.
   * @param options Optional target mutation guarded by relation creation.
   */
  public async createMemoryRelation(
    fromMemoryId: string,
    toMemoryId: string,
    relationType: RelationType,
    options: { markTargetNotLatest?: boolean; reinforceTargetPreference?: boolean } = {}
  ): Promise<boolean> {
    if (
      relationType !== RelationType.Updates &&
      relationType !== RelationType.Extends &&
      relationType !== RelationType.Derives
    ) {
      throw new Error(`Unsupported memory-to-memory relation type: ${relationType}`);
    }

    const session = this.driver.session();
    try {
      const result = await session.run(
        `
        MATCH (from:Memory {id: $fromMemoryId})
        MATCH (to:Memory {id: $toMemoryId})
        OPTIONAL MATCH (from)-[existing:${relationType}]->(to)
        WITH from, to, count(existing) AS existingCount
        OPTIONAL MATCH (source:Document)-[preserved:REPAIR_EXTENDS]->(to)
        WHERE $checkRepairMarker AND source.id = from.sourceDocId
        WITH from, to, existingCount, count(preserved) > 0 AS preservedFromRepair
        MERGE (from)-[r:${relationType}]->(to)
        FOREACH (_ IN CASE WHEN $markTargetNotLatest THEN [1] ELSE [] END |
          SET to.isLatest = false
        )
        FOREACH (_ IN CASE WHEN $reinforceTargetPreference AND existingCount = 0 AND NOT preservedFromRepair AND to.forgottenAt IS NULL THEN [1] ELSE [] END |
          SET to.originalConfidence = coalesce(to.originalConfidence, to.confidence),
              to.confidence = CASE
                WHEN coalesce(to.confidence, 0) + 0.15 > 1 THEN 1
                ELSE coalesce(to.confidence, 0) + 0.15
              END,
              to.lastReinforcedAt = datetime()
        )
        RETURN existingCount = 0 AS created
        `,
        {
          fromMemoryId,
          toMemoryId,
          checkRepairMarker: relationType === RelationType.Extends,
          markTargetNotLatest: options.markTargetNotLatest ?? false,
          reinforceTargetPreference: options.reinforceTargetPreference ?? false
        }
      );
      return Boolean(result.records[0]?.get("created"));
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
      originalConfidence:
        props.originalConfidence === null || props.originalConfidence === undefined
          ? null
          : Number(props.originalConfidence),
      embedding: (props.embedding as number[]) ?? [],
      validFrom: this.toNullableIsoString(props.validFrom),
      validTo: this.toNullableIsoString(props.validTo),
      forgottenAt: this.toNullableIsoString(props.forgottenAt),
      createdAt: this.toIsoString(props.createdAt),
      sourceDocId: String(props.sourceDocId)
    };
  }

  private mapChunk(nodeValue: unknown): Chunk {
    const props = this.nodeProps(nodeValue);
    return {
      id: String(props.id),
      content: String(props.content),
      embedding: (props.embedding as number[]) ?? [],
      chunkIndex: Number(props.chunkIndex),
      containerTag: String(props.containerTag),
      metadata: (props.metadata as Metadata) ?? {},
      sourceDocId: String(props.sourceDocId)
    };
  }

  private mapProfile(nodeValue: unknown): Profile {
    const props = this.nodeProps(nodeValue);
    return {
      containerTag: String(props.containerTag),
      static: String(props.static ?? ""),
      dynamic: String(props.dynamic ?? ""),
      generatedAt: this.toIsoString(props.generatedAt)
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
