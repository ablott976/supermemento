import { loadConfig } from "../config.js";
import { Neo4jClient } from "../db/neo4j-client.js";
import { EmbeddingService } from "../services/embedding.js";
import { ForgettingService } from "../services/forgetting.js";
import { IngestionPipeline } from "../services/ingestion/pipeline.js";
import { MemoryExtractorService } from "../services/ingestion/memory-extractor.js";
import { memoryContentHash } from "../services/memory-policy.js";
import { RelationClassifierService } from "../services/relation-classifier.js";

const USAGE =
  "Usage: repair-knowledge reclassify-memory <uuid> | reprocess-document <uuid> <repairId> | " +
  "backfill-content-hashes | dedupe-history <runId> [--apply] | restore-dedupe <runId>";
const BACKFILL_BATCH_SIZE = 500;
const RUN_ID_PATTERN = /^[a-z0-9._:-]{3,80}$/i;

function requireUuid(value: string | undefined, label: string): string {
  if (!value || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`${label} must be a UUID`);
  }
  return value;
}

function requireRunId(value: string | undefined, label: string): string {
  if (!value || !RUN_ID_PATTERN.test(value)) {
    throw new Error(`${label} must be a 3-80 character operational identifier`);
  }
  return value;
}

/**
 * Computes contentHash for memories created before exact dedup existed. Idempotent: only
 * memories without a hash are touched, in batches, until none remain.
 */
async function backfillContentHashes(neo4jClient: Neo4jClient): Promise<{ hashed: number; batches: number }> {
  let hashed = 0;
  let batches = 0;
  for (;;) {
    const pending = await neo4jClient.listMemoriesMissingContentHash(BACKFILL_BATCH_SIZE);
    if (pending.length === 0) {
      break;
    }
    hashed += await neo4jClient.setMemoryContentHashes(
      pending.map((memory) => ({ id: memory.id, contentHash: memoryContentHash(memory.containerTag, memory.content) }))
    );
    batches += 1;
  }
  return { hashed, batches };
}

/**
 * Reversible cleanup of historical exact duplicates: the oldest active memory of each group stays
 * canonical, the rest become isLatest=false with DUPLICATE_OF relations and run markers. Nothing
 * is deleted. Without --apply it only reports the groups.
 */
async function dedupeHistory(neo4jClient: Neo4jClient, runId: string, apply: boolean): Promise<{
  runId: string;
  applied: boolean;
  groups: number;
  duplicates: number;
  retired: number;
  details: Array<{ containerTag: string; canonicalId: string; duplicateIds: string[]; content: string }>;
}> {
  const groups = await neo4jClient.findDuplicateMemoryGroups();
  const details = groups.map((group) => {
    const [canonical, ...duplicates] = group.members;
    return {
      containerTag: group.containerTag,
      canonicalId: canonical?.id ?? "",
      duplicateIds: duplicates.map((member) => member.id),
      content: (canonical?.content ?? "").slice(0, 120)
    };
  });
  let retired = 0;
  if (apply) {
    for (const group of details) {
      if (!group.canonicalId || group.duplicateIds.length === 0) {
        continue;
      }
      retired += await neo4jClient.retireDuplicateMemories({
        canonicalId: group.canonicalId,
        duplicateIds: group.duplicateIds,
        runId
      });
    }
  }
  return {
    runId,
    applied: apply,
    groups: details.length,
    duplicates: details.reduce((total, group) => total + group.duplicateIds.length, 0),
    retired,
    details
  };
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const config = loadConfig();
  const neo4jClient = new Neo4jClient(config);

  try {
    if (command === "backfill-content-hashes") {
      const result = await backfillContentHashes(neo4jClient);
      console.log(JSON.stringify({ command, ...result }));
      return;
    }

    if (command === "dedupe-history") {
      const runId = requireRunId(rest[0], "runId");
      const apply = rest.includes("--apply");
      const result = await dedupeHistory(neo4jClient, runId, apply);
      console.log(JSON.stringify({ command, ...result }));
      return;
    }

    if (command === "restore-dedupe") {
      const runId = requireRunId(rest[0], "runId");
      const restored = await neo4jClient.restoreRetiredDuplicates(runId);
      console.log(JSON.stringify({ command, runId, restored }));
      return;
    }

    if (command === "reclassify-memory" || command === "reprocess-document") {
      const [rawId, repairId] = rest;
      const id = requireUuid(rawId, command === "reprocess-document" ? "documentId" : "memoryId");
      const embeddingService = new EmbeddingService(config);
      const forgettingService = new ForgettingService(neo4jClient);
      const relationClassifierService = new RelationClassifierService(
        config,
        neo4jClient,
        embeddingService,
        forgettingService
      );

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

      const validRepairId = requireRunId(repairId, "repairId");
      const prepared = await neo4jClient.prepareDocumentForReprocessing(id, validRepairId);
      const memoryExtractorService = new MemoryExtractorService(config);
      const pipeline = new IngestionPipeline(
        neo4jClient,
        embeddingService,
        relationClassifierService,
        memoryExtractorService
      );
      try {
        const result = await pipeline.processDocument(id);
        await neo4jClient.completeDocumentReprocessing(id, validRepairId);
        console.log(JSON.stringify({
          command,
          documentId: id,
          status: result.document.status,
          deletedChunkCount: prepared.deletedChunkCount,
          deletedMemoryCount: prepared.deletedMemoryCount,
          chunkCount: result.chunkCount,
          memoryCount: result.memoryCount,
          duplicateCount: result.duplicateCount,
          rejectedCount: result.rejectedCount
        }));
      } catch (error) {
        await neo4jClient.releaseDocumentReprocessing(id, validRepairId);
        throw error;
      }
      return;
    }

    throw new Error(USAGE);
  } finally {
    await neo4jClient.close();
  }
}

main().catch((error) => {
  console.error(`[repair-knowledge] ${(error as Error).message}`);
  process.exit(1);
});
