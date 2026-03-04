import { MemoryType } from "../types/enums.js";
import { Neo4jClient } from "../db/neo4j-client.js";

/** Automatic forgetting and confidence decay service. */
export class ForgettingService {
  private readonly neo4jClient: Neo4jClient;

  /**
   * Creates the forgetting service.
   * @param neo4jClient Database client.
   */
  public constructor(neo4jClient: Neo4jClient) {
    this.neo4jClient = neo4jClient;
  }

  /**
   * Soft-deletes expired episode memories.
   */
  public async softDeleteExpiredEpisodes(): Promise<number> {
    return this.neo4jClient.softDeleteExpiredEpisodes();
  }

  /**
   * Applies confidence decay to preference and derived memories.
   */
  public async applyConfidenceDecay(): Promise<{ decayedMemories: number; softDeleted: number }> {
    const preferenceResult = await this.neo4jClient.applyConfidenceDecay(MemoryType.Preference, 180);
    const derivedResult = await this.neo4jClient.applyConfidenceDecay(MemoryType.Derived, 90);

    return {
      decayedMemories: preferenceResult.decayedCount + derivedResult.decayedCount,
      softDeleted: preferenceResult.softDeletedCount + derivedResult.softDeletedCount
    };
  }

  /**
   * Reinforces a preference memory after an EXTEND relation.
   * @param memoryId Memory identifier.
   */
  public async reinforcePreference(memoryId: string): Promise<boolean> {
    const memory = await this.neo4jClient.reinforcePreference(memoryId);
    return memory !== null;
  }

  /**
   * Runs the full maintenance cycle.
   */
  public async runMaintenanceCycle(): Promise<{
    expiredEpisodes: number;
    decayedMemories: number;
    softDeleted: number;
  }> {
    const expiredEpisodes = await this.softDeleteExpiredEpisodes();
    const decayStats = await this.applyConfidenceDecay();

    return {
      expiredEpisodes,
      decayedMemories: decayStats.decayedMemories,
      softDeleted: expiredEpisodes + decayStats.softDeleted
    };
  }

  /**
   * Manually soft-deletes one memory by id.
   * @param memoryId Memory identifier.
   */
  public async forgetMemory(memoryId: string): Promise<boolean> {
    return this.neo4jClient.softDeleteMemoryById(memoryId);
  }
}
