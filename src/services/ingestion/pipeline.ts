import { Neo4jClient } from "../../db/neo4j-client.js";
import { ContentType, DocumentStatus } from "../../types/enums.js";
import type { Document, Metadata } from "../../types/models.js";
import { EmbeddingService } from "../embedding.js";
import {
  documentTemporalPolicy,
  memoryContentHash,
  withTemporalClass
} from "../memory-policy.js";
import { RelationClassifierService } from "../relation-classifier.js";
import { ChunkingService, type ChunkPayload } from "./chunker.js";
import { MemoryExtractorService, type ExtractedMemory } from "./memory-extractor.js";
import { ImageExtractor } from "./extractors/image.js";
import { PdfExtractor } from "./extractors/pdf.js";
import {
  ConversationExtractor,
  TextExtractor,
  UrlExtractor,
  type Extractor
} from "./extractors/index.js";

export type PipelineInput = {
  title: string;
  contentType: ContentType;
  rawContent: string;
  containerTag: string;
  metadata?: Metadata;
  sourceUrl?: string;
  filePath?: string;
};

export type PipelineResult = {
  document: Document;
  chunkCount: number;
  /** Memories actually created. */
  memoryCount: number;
  /** Extracted memories skipped because an active memory with the same normalised content exists. */
  duplicateCount: number;
  /** Extracted memories skipped because the document's temporal_class requires a validTo none was found. */
  rejectedCount: number;
};

/** Document metadata keys written by the pipeline with the outcome of the memory policy. */
export const PIPELINE_RESULT_METADATA_KEYS = {
  created: "memories_created",
  duplicate: "memories_duplicate",
  rejected: "memories_rejected"
} as const;

/** End-to-end multimodal ingestion orchestrator. */
export class IngestionPipeline {
  private readonly neo4jClient: Neo4jClient;
  private readonly embeddingService: EmbeddingService;
  private readonly relationClassifierService: RelationClassifierService;
  private readonly chunkingService: ChunkingService;
  private readonly memoryExtractorService: MemoryExtractorService;

  /**
   * Creates the ingestion pipeline.
   */
  public constructor(
    neo4jClient: Neo4jClient,
    embeddingService: EmbeddingService,
    relationClassifierService: RelationClassifierService,
    memoryExtractorService: MemoryExtractorService
  ) {
    this.neo4jClient = neo4jClient;
    this.embeddingService = embeddingService;
    this.relationClassifierService = relationClassifierService;
    this.chunkingService = new ChunkingService();
    this.memoryExtractorService = memoryExtractorService;
  }

  /**
   * Creates a document and runs full ingestion.
   * @param input Ingestion input.
   */
  public async ingest(input: PipelineInput): Promise<PipelineResult> {
    const document = await this.neo4jClient.createDocument(input);
    return this.processDocument(document.id);
  }

  /**
   * Runs pipeline stages for an existing document.
   * @param documentId Document id.
   */
  public async processDocument(documentId: string): Promise<PipelineResult> {
    const document = await this.neo4jClient.getDocument(documentId);
    if (!document) {
      throw new Error(`Document not found: ${documentId}`);
    }

    try {
      await this.setStatus(document.id, DocumentStatus.Extracting);
      const extractor = this.getExtractor(document.contentType);
      const extractedText = await extractor.extract(document);
      const extractedDoc = await this.neo4jClient.updateDocument(document.id, {
        rawContent: extractedText,
        status: DocumentStatus.Extracting
      });

      await this.setStatus(document.id, DocumentStatus.Chunking);
      const chunks = this.chunkingService.chunk(
        {
          ...document,
          rawContent: extractedText
        },
        extractedText
      );

      await this.setStatus(document.id, DocumentStatus.ExtractingMemories);
      const filterPrompt = await this.neo4jClient.getContainerFilterPrompt(document.containerTag);
      const extractedMemories = await this.extractMemories(chunks, filterPrompt);
      // Same rules as create_memory: validTo mandatory for temporal intelligence and no exact duplicates,
      // applied before spending embeddings on memories that will not be stored.
      const { accepted, duplicateCount, rejectedCount } = await this.applyMemoryPolicy(document, extractedMemories);

      await this.setStatus(document.id, DocumentStatus.Embedding);
      const chunkEmbeddings = await this.embeddingService.generateEmbeddings(
        chunks.map((chunk) => chunk.content)
      );
      const memoryEmbeddings = accepted.length === 0
        ? []
        : await this.embeddingService.generateEmbeddings(accepted.map((memory) => memory.content));

      await this.setStatus(document.id, DocumentStatus.Indexing);
      if (chunks.length > 0) {
        await this.neo4jClient.createChunks(
          chunks.map((chunk, index) => ({
            content: chunk.content,
            chunkIndex: chunk.chunkIndex,
            containerTag: document.containerTag,
            sourceDocId: document.id,
            metadata: typeof chunk.metadata === "object" ? JSON.stringify(chunk.metadata) : (chunk.metadata ?? ""),
            embedding: chunkEmbeddings[index] ?? []
          }))
        );
      }

      let createdCount = 0;
      for (let i = 0; i < accepted.length; i += 1) {
        const acceptedMemory = accepted[i];
        if (!acceptedMemory) {
          continue;
        }

        const embedding = memoryEmbeddings[i];
        if (!embedding) {
          continue;
        }

        const memory = await this.neo4jClient.createMemory({
          content: acceptedMemory.content,
          memoryType: acceptedMemory.memoryType,
          containerTag: document.containerTag,
          confidence: acceptedMemory.confidence,
          metadata: acceptedMemory.metadata,
          validFrom: acceptedMemory.validFrom ?? undefined,
          validTo: acceptedMemory.validTo ?? undefined,
          sourceDocId: document.id,
          embedding
        });
        createdCount += 1;

        try {
          await this.relationClassifierService.classifyAndApply(memory);
        } catch (e) {
          console.warn(`[pipeline] RelationClassifier skipped for memory ${memory.id}:`, (e as Error).message);
        }
      }

      const finalDocument = await this.neo4jClient.updateDocument(document.id, {
        status: DocumentStatus.Done,
        rawContent: extractedText,
        metadata: {
          ...document.metadata,
          [PIPELINE_RESULT_METADATA_KEYS.created]: createdCount,
          [PIPELINE_RESULT_METADATA_KEYS.duplicate]: duplicateCount,
          [PIPELINE_RESULT_METADATA_KEYS.rejected]: rejectedCount
        }
      });

      if (!finalDocument && !extractedDoc) {
        throw new Error(`Failed to update final status for document ${document.id}`);
      }

      return {
        document: finalDocument ?? extractedDoc ?? document,
        chunkCount: chunks.length,
        memoryCount: createdCount,
        duplicateCount,
        rejectedCount
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown pipeline error";
      await this.neo4jClient.updateDocument(document.id, {
        status: DocumentStatus.Error,
        metadata: {
          ...document.metadata,
          pipelineError: message,
          pipelineErrorAt: new Date().toISOString()
        }
      });
      throw error;
    }
  }

  /**
   * Applies the memory policy to extracted memories: inherits the document's default validTo,
   * rejects temporal intelligence without validTo and drops exact duplicates (within the document
   * and against active memories already stored in the container).
   * @param document Source document with temporal policy metadata.
   * @param extractedMemories Memories proposed by the extractor.
   */
  private async applyMemoryPolicy(
    document: Document,
    extractedMemories: ExtractedMemory[]
  ): Promise<{
    accepted: Array<ExtractedMemory & { metadata: Metadata }>;
    duplicateCount: number;
    rejectedCount: number;
  }> {
    const policy = documentTemporalPolicy(document.metadata);
    const seenHashes = new Set<string>();
    const accepted: Array<ExtractedMemory & { metadata: Metadata }> = [];
    let duplicateCount = 0;
    let rejectedCount = 0;

    for (const extracted of extractedMemories) {
      const validTo = extracted.validTo ?? policy.validTo;
      if (policy.temporalClass !== "none" && !validTo) {
        rejectedCount += 1;
        console.warn(
          `[pipeline] Rejected memory without validTo for temporal_class=${policy.temporalClass} in document ${document.id}`
        );
        continue;
      }

      const contentHash = memoryContentHash(document.containerTag, extracted.content);
      if (seenHashes.has(contentHash)) {
        duplicateCount += 1;
        continue;
      }
      const existing = await this.neo4jClient.findActiveMemoryByContentHash(document.containerTag, contentHash);
      if (existing) {
        duplicateCount += 1;
        console.info(`[pipeline] Skipped duplicate of memory ${existing.id} in document ${document.id}`);
        continue;
      }

      seenHashes.add(contentHash);
      accepted.push({
        ...extracted,
        validTo,
        metadata: withTemporalClass(undefined, policy.temporalClass)
      });
    }

    return { accepted, duplicateCount, rejectedCount };
  }

  private async extractMemories(
    chunks: ChunkPayload[],
    filterPrompt: string | null
  ): Promise<ExtractedMemory[]> {
    const allMemories: ExtractedMemory[] = [];

    for (const chunk of chunks) {
      const memories = await this.memoryExtractorService.extractFromChunk(chunk.content, {
        filterPrompt
      });
      allMemories.push(...memories);
    }

    return allMemories;
  }

  private getExtractor(contentType: ContentType): Extractor {
    if (contentType === ContentType.Url) {
      return new UrlExtractor();
    }

    if (contentType === ContentType.Pdf) {
      return new PdfExtractor();
    }

    if (contentType === ContentType.Image) {
      return new ImageExtractor();
    }

    if (contentType === ContentType.Conversation) {
      return new ConversationExtractor();
    }

    return new TextExtractor();
  }

  private async setStatus(documentId: string, status: DocumentStatus): Promise<void> {
    await this.neo4jClient.updateDocument(documentId, { status });
  }

  /**
   * Sets the configuration for a container, including filter prompts.
   * @param containerTag The tag of the container.
   * @param config The configuration object.
   */
  public async set_container_config(containerTag: string, config: { filterPrompt?: string | null }): Promise<void> {
    // Assuming Neo4jClient will have a method to set container configuration.
    // If this method does not exist, it will need to be added to Neo4jClient.
    await this.neo4jClient.setContainerConfig(containerTag, config.filterPrompt ?? null);
  }
}
