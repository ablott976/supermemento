import { Neo4jClient } from "../../db/neo4j-client.js";
import { ContentType, DocumentStatus } from "../../types/enums.js";
import type { Document, Memory, Metadata } from "../../types/models.js";
import { EmbeddingService } from "../embedding.js";
import { RelationClassifierService } from "../relation-classifier.js";
import { ChunkingService, type ChunkPayload } from "./chunker.js";
import { MemoryExtractorService, type ExtractedMemory } from "./memory-extractor.js";
import { ConversationExtractor, TextExtractor, UrlExtractor, type Extractor } from "./extractors/index.js";
import { batchCreateMemories, gatherWithLimit, parallelExtractMemories } from "./batching.js";

export type PipelineInput = {
  title: string;
  contentType: ContentType;
  rawContent: string;
  containerTag: string;
  metadata?: Metadata;
  sourceUrl?: string;
  filePath?: string;
};

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
  public async ingest(input: PipelineInput): Promise<{
    document: Document;
    chunkCount: number;
    memoryCount: number;
  }> {
    const document = await this.neo4jClient.createDocument(input);
    const result = await this.processDocument(document.id);
    return {
      document: result.document,
      chunkCount: result.chunkCount,
      memoryCount: result.memoryCount,
    };
  }

  /**
   * Runs pipeline stages for an existing document.
   * @param documentId Document id.
   */
  public async processDocument(documentId: string): Promise<{
    document: Document;
    chunkCount: number;
    memoryCount: number;
  }> {
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
        status: DocumentStatus.Extracting,
      });

      await this.setStatus(document.id, DocumentStatus.Chunking);
      const chunks = this.chunkingService.chunk(
        { ...document, rawContent: extractedText },
        extractedText
      );

      await this.setStatus(document.id, DocumentStatus.ExtractingMemories);
      const filterPrompt = await this.neo4jClient.getContainerFilterPrompt(document.containerTag);
      const extractedMemories = await this.extractMemories(chunks, filterPrompt);

      await this.setStatus(document.id, DocumentStatus.Embedding);
      const chunkEmbeddings = await this.embeddingService.generateEmbeddings(
        chunks.map((chunk) => chunk.content)
      );
      const memoryEmbeddings = await this.embeddingService.generateEmbeddings(
        extractedMemories.map((memory) => memory.content)
      );

      await this.setStatus(document.id, DocumentStatus.Indexing);
      if (chunks.length > 0) {
        await this.neo4jClient.createChunks(
          chunks.map((chunk, index) => ({
            content: chunk.content,
            chunkIndex: chunk.chunkIndex,
            containerTag: document.containerTag,
            sourceDocId: document.id,
            metadata: typeof chunk.metadata === "object" ? JSON.stringify(chunk.metadata) : (chunk.metadata ?? ""),
            embedding: chunkEmbeddings[index] ?? [],
          }))
        );
      }

      const memoryInputs = extractedMemories
        .map((extractedMemory, i) => {
          const embedding = memoryEmbeddings[i];
          if (!extractedMemory || !embedding) return null;
          return {
            content: extractedMemory.content,
            memoryType: extractedMemory.memoryType,
            containerTag: document.containerTag,
            confidence: extractedMemory.confidence,
            embedding,
            sourceDocId: document.id,
            validFrom: extractedMemory.validFrom ?? null,
            validTo: extractedMemory.validTo ?? null,
          };
        })
        .filter((input): input is NonNullable<typeof input> => input !== null);

      const memoryIds = await batchCreateMemories(this.neo4jClient, memoryInputs);

      if (memoryIds.length > 0) {
        const now = new Date().toISOString();
        const createdMemories = memoryIds
          .map((id, index) => {
            const input = memoryInputs[index];
            if (!input) return null;
            return {
              id,
              ...input,
              isLatest: true,
              createdAt: now,
            } as Memory;
          })
          .filter((memory): memory is Memory => memory !== null);

        await gatherWithLimit(
          createdMemories,
          async (memory) => {
            try {
              await this.relationClassifierService.classifyAndApply(memory);
            } catch (e) {
              console.warn(`[pipeline] RelationClassifier skipped for memory ${memory.id}:`, (e as Error).message);
            }
          },
          5
        );
      }

      const finalDocument = await this.neo4jClient.updateDocument(document.id, {
        status: DocumentStatus.Done,
        rawContent: extractedText,
      });

      if (!finalDocument && !extractedDoc) {
        throw new Error(`Failed to update final status for document ${document.id}`);
      }

      return {
        document: finalDocument ?? extractedDoc ?? document,
        chunkCount: chunks.length,
        memoryCount: extractedMemories.length,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown pipeline error";
      const metaStr = JSON.stringify({
        pipelineError: message,
        pipelineErrorAt: new Date().toISOString(),
      });

      await this.neo4jClient.updateDocument(document.id, {
        status: DocumentStatus.Error,
        metadata: metaStr,
      });
      throw error;
    }
  }

  private async extractMemories(
    chunks: ChunkPayload[],
    filterPrompt: string | null
  ): Promise<ExtractedMemory[]> {
    return parallelExtractMemories(chunks, this.memoryExtractorService, filterPrompt);
  }

  private getExtractor(contentType: ContentType): Extractor {
    if (contentType === ContentType.Url) {
      return new UrlExtractor();
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
    await this.neo4jClient.setContainerConfig(containerTag, config.filterPrompt);
  }
}
