import { loadConfig } from "../config.js";
import { Neo4jClient } from "../db/neo4j-client.js";
import { EmbeddingService } from "../services/embedding.js";
import { ForgettingService } from "../services/forgetting.js";
import { IngestionPipeline } from "../services/ingestion/pipeline.js";
import { MemoryExtractorService } from "../services/ingestion/memory-extractor.js";
import { RelationClassifierService } from "../services/relation-classifier.js";

function requireUuid(value: string | undefined, label: string): string {
  if (!value || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`${label} must be a UUID`);
  }
  return value;
}

async function main(): Promise<void> {
  const [command, rawId, repairId] = process.argv.slice(2);
  const id = requireUuid(rawId, command === "reprocess-document" ? "documentId" : "memoryId");
  const config = loadConfig();
  const neo4jClient = new Neo4jClient(config);
  const embeddingService = new EmbeddingService(config);
  const forgettingService = new ForgettingService(neo4jClient);
  const relationClassifierService = new RelationClassifierService(
    config,
    neo4jClient,
    embeddingService,
    forgettingService
  );

  try {
    if (command === "reclassify-memory") {
      const memory = await neo4jClient.getMemory(id);
      if (!memory) {
        throw new Error(`Memory not found: ${id}`);
      }
      const result = await relationClassifierService.classifyAndApply(memory, {
        asOf: memory.createdAt
      });
      console.log(JSON.stringify({
        command,
        memoryId: id,
        candidateCount: result.candidateCount,
        appliedCount: result.applied.length
      }));
      return;
    }

    if (command === "reprocess-document") {
      if (!repairId || !/^[a-z0-9._:-]{3,80}$/i.test(repairId)) {
        throw new Error("repairId must be a 3-80 character operational identifier");
      }
      const prepared = await neo4jClient.prepareDocumentForReprocessing(id, repairId);
      const memoryExtractorService = new MemoryExtractorService(config);
      const pipeline = new IngestionPipeline(
        neo4jClient,
        embeddingService,
        relationClassifierService,
        memoryExtractorService
      );
      try {
        const result = await pipeline.processDocument(id);
        await neo4jClient.completeDocumentReprocessing(id, repairId);
        console.log(JSON.stringify({
          command,
          documentId: id,
          status: result.document.status,
          deletedChunkCount: prepared.deletedChunkCount,
          deletedMemoryCount: prepared.deletedMemoryCount,
          chunkCount: result.chunkCount,
          memoryCount: result.memoryCount
        }));
      } catch (error) {
        await neo4jClient.releaseDocumentReprocessing(id, repairId);
        throw error;
      }
      return;
    }

    throw new Error(
      "Usage: repair-knowledge reclassify-memory <uuid> | reprocess-document <uuid> <repairId>"
    );
  } finally {
    await neo4jClient.close();
  }
}

main().catch((error) => {
  console.error(`[repair-knowledge] ${(error as Error).message}`);
  process.exit(1);
});