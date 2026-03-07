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
	 * Updates a document.
	 * @param documentId Document identifier.
	 * @param input Fields to update.
	 */
	public async updateDocument(
		documentId: string,
		input: DocumentUpdateInput
	): Promise<Document | null> {
		const session = this.driver.session();
		const now = new Date().toISOString();

		try {
			const setClauses: string[] = ["d.updatedAt = datetime($updatedAt)"];
			const params: Record<string, unknown> = {
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
	 * Deletes a document and all its relations.
	 * @param documentId Document identifier.
	 */
	public async deleteDocument(documentId: string): Promise<boolean> {
		const session = this.driver.session();
		try {
			const result = await session.run(
				`
        MATCH (d:Document {id: $id})
        OPTIONAL MATCH (d)-[:HAS_CHUNK]->(c:Chunk)
        OPTIONAL MATCH (d)-[:EXTRACTED_FROM]->(m:Memory)
        DETACH DELETE d, c, m
        RETURN count(d) as deleted
      `,
				{ id: documentId }
			);
			return result.records[0]?.get("deleted") > 0;
		} finally {
			await session.close();
		}
	}

	/**
	 * Creates a :Memory node.
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
          createdAt: datetime($createdAt)
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
					sourceDocId: input.sourceDocId,
					validFrom: input.validFrom ?? now,
					validTo: input.validTo ?? null,
					createdAt: now,
				}
			);

			return this.mapMemory(result.records[0]?.get("m"));
		} finally {
			await session.close();
		}
	}

	/**
	 * Returns a memory by id.
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
	 * Lists memories filtered by container tag, type, and isLatest flag.
	 * @param params Listing filters.
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
					isLatest: params.isLatest ?? null,
					limit: neo4j.int(params.limit ?? 50),
				}
			);

			return result.records.map((record) => this.mapMemory(record.get("m")));
		} finally {
			await session.close();
		}
	}

	/**
	 * Updates a memory.
	 * @param memoryId Memory identifier.
	 * @param input Fields to update.
	 */
	public async updateMemory(
		memoryId: string,
		input: MemoryUpdateInput
	): Promise<Memory | null> {
		const session = this.driver.session();

		try {
			const setClauses: string[] = [];
			const params: Record<string, unknown> = { id: memoryId };

			if (input.content !== undefined) {
				setClauses.push("m.content = $content");
				params.content = input.content;
			}
			if (input.memoryType !== undefined) {
				setClauses.push("m.memoryType = $memoryType");
				params.memoryType = input.memoryType;
			}
			if (input.isLatest !== undefined) {
				setClauses.push("m.isLatest = $isLatest");
				params.isLatest = input.isLatest;
			}
			if (input.confidence !== undefined) {
				setClauses.push("m.confidence = $confidence");
				params.confidence = input.confidence;
			}
			if (input.validFrom !== undefined) {
				setClauses.push("m.validFrom = datetime($validFrom)");
				params.validFrom = input.validFrom;
			}
			if (input.validTo !== undefined) {
				setClauses.push("m.validTo = datetime($validTo)");
				params.validTo = input.validTo;
			}
			if (input.forgottenAt !== undefined) {
				setClauses.push("m.forgottenAt = datetime($forgottenAt)");
				params.forgottenAt = input.forgottenAt;
			}

			if (setClauses.length === 0) {
				return this.getMemory(memoryId);
			}

			const result = await session.run(
				`
        MATCH (m:Memory {id: $id})
        SET ${setClauses.join(", ")}
        RETURN m
      `,
				params
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
	 * Deletes a memory.
	 * @param memoryId Memory identifier.
	 */
	public async deleteMemory(memoryId: string): Promise<boolean> {
		const session = this.driver.session();
		try {
			const result = await session.run(
				`
        MATCH (m:Memory {id: $id})
        DETACH DELETE m
        RETURN count(m) as deleted
      `,
				{ id: memoryId }
			);
			return result.records[0]?.get("deleted") > 0;
		} finally {
			await session.close();
		}
	}

	/**
	 * Creates a :Chunk node linked to a document.
	 * @param input Chunk fields.
	 * @returns Created chunk.
	 */
	public async createChunk(input: ChunkCreateInput): Promise<Chunk> {
		const session = this.driver.session();
		const now = new Date().toISOString();
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
          createdAt: datetime($createdAt)
        })
        CREATE (d)-[:HAS_CHUNK]->(c)
        RETURN c
      `,
				{
					id,
					content: input.content,
					embedding: input.embedding,
					chunkIndex: input.chunkIndex,
					containerTag: input.containerTag,
					metadata:
						typeof input.metadata === "string"
							? input.metadata
							: JSON.stringify(input.metadata ?? {}),
					sourceDocId: input.sourceDocId,
					createdAt: now,
				}
			);

			return this.mapChunk(result.records[0]?.get("c"));
		} finally {
			await session.close();
		}
	}

	/**
	 * Creates a relation between two memories.
	 * @param sourceMemoryId Source memory ID.
	 * @param targetMemoryId Target memory ID.
	 * @param relationType Type of relation.
	 */
	public async createRelation(
		sourceMemoryId: string,
		targetMemoryId: string,
		relationType: RelationType
	): Promise<MemoryRelation> {
		const session = this.driver.session();
		const now = new Date().toISOString();
		const id = uuidv4();

		try {
			const result = await session.run(
				`
        MATCH (m1:Memory {id: $sourceId})
        MATCH (m2:Memory {id: $targetId})
        CREATE (m1)-[r:${relationType} {
          id: $id,
          createdAt: datetime($createdAt)
        }]->(m2)
        RETURN r, m1, m2
      `,
				{
					id,
					sourceId: sourceMemoryId,
					targetId: targetMemoryId,
					createdAt: now,
				}
			);

			const record = result.records[0];
			return {
				id: record.get("r").properties.id,
				sourceMemoryId: record.get("
