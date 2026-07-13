import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AppConfig } from "../config.js";
import { MemoryType } from "../types/index.js";
import type { Memory } from "../types/index.js";
import { RelationClassifierService } from "./relation-classifier.js";

type TextResponse = {
  content: Array<{ type: "text"; text: string }>;
};

type RelationClassifierInternals = {
  anthropic: {
    messages: {
      create: (input?: { max_tokens?: number }) => Promise<TextResponse>;
    };
  };
  extractJson: (raw: string) => unknown;
  classify: (
    newMemory: Memory,
    candidates: Memory[]
  ) => Promise<{
    relations: Array<{
      existingMemoryId: string;
      relationType: "UPDATE" | "EXTEND" | "DERIVE" | "NONE";
      confidence: number;
      derivedFact?: string;
    }>;
  }>;
  batchClassify: (
    entries: Array<{
      newMemory: Memory;
      candidates: Array<{ memory: Memory; score: number }>;
    }>
  ) => Promise<{
    classifications: Array<{
      newMemoryId: string;
      relations: Array<{
        existingMemoryId: string;
        relationType: "UPDATE" | "EXTEND" | "DERIVE" | "NONE";
        confidence: number;
        derivedFact?: string;
      }>;
    }>;
  }>;
};

function makeMemory(id: string, content: string): Memory {
  return {
    id,
    content,
    memoryType: MemoryType.Fact,
    containerTag: "test-relations",
    isLatest: true,
    confidence: 0.9,
    embedding: [0.1, 0.2],
    createdAt: "2026-07-13T00:00:00.000Z",
    sourceDocId: "test-document"
  };
}

function makeService(responseText?: string): RelationClassifierInternals {
  const service = new RelationClassifierService(
    {
      ANTHROPIC_API_KEY: "test-key",
      ANTHROPIC_MODEL: "test-model"
    } as AppConfig,
    {} as never,
    {} as never,
    {} as never
  ) as unknown as RelationClassifierInternals;

  if (responseText !== undefined) {
    service.anthropic = {
      messages: {
        create: async () => ({
          content: [{ type: "text", text: responseText }]
        })
      }
    };
  }

  return service;
}

describe("RelationClassifierService response normalization", () => {
  it("parses plain, fenced, explanatory and trailing-comma JSON", () => {
    const service = makeService();
    const expected = { relations: [] };

    assert.deepEqual(service.extractJson('{"relations":[]}'), expected);
    assert.deepEqual(
      service.extractJson('```json\n{"relations":[]}\n```'),
      expected
    );
    assert.deepEqual(
      service.extractJson('```\n{"relations":[]}\n```'),
      expected
    );
    assert.deepEqual(
      service.extractJson('Resultado:\n```JSON\n{"relations":[],}\n```\nFin.'),
      expected
    );
    assert.deepEqual(
      service.extractJson(
        '{"relations":[{"derivedFact":"Conserva,}",}],}'
      ),
      { relations: [{ derivedFact: "Conserva,}" }] }
    );
  });

  it("reserves enough output tokens for all candidate relations", async () => {
    const service = makeService();
    let maxTokens: number | undefined;
    service.anthropic = {
      messages: {
        create: async (input) => {
          maxTokens = input?.max_tokens;
          return { content: [{ type: "text", text: '{"relations":[]}' }] };
        }
      }
    };

    await service.classify(makeMemory("new", "New fact"), [
      makeMemory("existing", "Existing fact")
    ]);
    assert.equal(maxTokens, 4000);
  });

  it("accepts and removes derivedFact null for a non-DERIVE relation", async () => {
    const response = JSON.stringify({
      relations: [
        {
          existingMemoryId: "existing",
          relationType: "EXTEND",
          confidence: 0.91,
          derivedFact: null
        }
      ]
    });
    const service = makeService(`\`\`\`\n${response}\n\`\`\``);

    const result = await service.classify(
      makeMemory("new", "New detail"),
      [makeMemory("existing", "Existing fact")]
    );

    assert.deepEqual(result.relations, [
      {
        existingMemoryId: "existing",
        relationType: "EXTEND",
        confidence: 0.91,
        derivedFact: undefined
      }
    ]);
  });

  it("accepts and removes a blank derivedFact for a non-DERIVE relation", async () => {
    const response = JSON.stringify({
      relations: [
        {
          existingMemoryId: "existing",
          relationType: "UPDATE",
          confidence: 0.87,
          derivedFact: "   "
        }
      ]
    });
    const service = makeService(response);

    const result = await service.classify(
      makeMemory("new", "Replacement fact"),
      [makeMemory("existing", "Existing fact")]
    );

    assert.deepEqual(result.relations, [
      {
        existingMemoryId: "existing",
        relationType: "UPDATE",
        confidence: 0.87,
        derivedFact: undefined
      }
    ]);
  });

  it("does not treat literal code fences inside valid JSON as an outer wrapper", () => {
    const service = makeService();
    const expected = {
      relations: [
        {
          existingMemoryId: "existing",
          relationType: "DERIVE",
          confidence: 0.95,
          derivedFact: "Preserve this example: ```json\n{\"active\":true}\n```"
        }
      ]
    };

    assert.deepEqual(service.extractJson(JSON.stringify(expected)), expected);
  });

  it("normalizes derivedFact null in batch responses", async () => {
    const response = JSON.stringify({
      classifications: [
        {
          newMemoryId: "new",
          relations: [
            {
              existingMemoryId: "existing",
              relationType: "NONE",
              confidence: 0.8,
              derivedFact: null
            }
          ]
        }
      ]
    });
    const service = makeService(`Response:\n\`\`\`json\n${response}\n\`\`\``);
    const newMemory = makeMemory("new", "New fact");
    const existing = makeMemory("existing", "Existing fact");

    const result = await service.batchClassify([
      {
        newMemory,
        candidates: [{ memory: existing, score: 0.9 }]
      }
    ]);

    assert.deepEqual(result.classifications[0]?.relations[0], {
      existingMemoryId: "existing",
      relationType: "NONE",
      confidence: 0.8,
      derivedFact: undefined
    });
  });

  it("rejects DERIVE without a non-empty derived fact", async () => {
    const response = JSON.stringify({
      relations: [
        {
          existingMemoryId: "existing",
          relationType: "DERIVE",
          confidence: 0.95,
          derivedFact: null
        }
      ]
    });
    const service = makeService(response);

    await assert.rejects(
      service.classify(
        makeMemory("new", "New fact"),
        [makeMemory("existing", "Existing fact")]
      ),
      /derivedFact/
    );
  });

  it("rejects batch DERIVE without a non-empty derived fact", async () => {
    const response = JSON.stringify({
      classifications: [
        {
          newMemoryId: "new",
          relations: [
            {
              existingMemoryId: "existing",
              relationType: "DERIVE",
              confidence: 0.95,
              derivedFact: null
            }
          ]
        }
      ]
    });
    const service = makeService(response);
    const newMemory = makeMemory("new", "New fact");
    const existing = makeMemory("existing", "Existing fact");

    await assert.rejects(
      service.batchClassify([
        {
          newMemory,
          candidates: [{ memory: existing, score: 0.9 }]
        }
      ]),
      /derivedFact/
    );
  });

  it("delegates preference reinforcement to the atomic relation write", async () => {
    const existing = {
      ...makeMemory("existing", "Existing preference"),
      memoryType: MemoryType.Preference
    };
    const newMemory = makeMemory("new", "Additional preference detail");
    let reinforcementCount = 0;
    let relationOptions: { reinforceTargetPreference?: boolean } | undefined;
    const neo4jClient = {
      semanticSearchMemories: async () => [{ memory: existing, score: 0.9 }],
      createMemoryRelation: async (
        _from: string,
        _to: string,
        _type: string,
        options?: { reinforceTargetPreference?: boolean }
      ) => {
        relationOptions = options;
        return false;
      }
    };
    const forgettingService = {
      reinforcePreference: async () => {
        reinforcementCount += 1;
        return true;
      }
    };
    const service = new RelationClassifierService(
      {
        ANTHROPIC_API_KEY: "test-key",
        ANTHROPIC_MODEL: "test-model"
      } as AppConfig,
      neo4jClient as never,
      {} as never,
      forgettingService as never
    ) as unknown as RelationClassifierInternals & {
      classifyAndApply: RelationClassifierService["classifyAndApply"];
    };
    service.anthropic = {
      messages: {
        create: async () => ({
          content: [{
            type: "text",
            text: JSON.stringify({
              relations: [{
                existingMemoryId: "existing",
                relationType: "EXTEND",
                confidence: 0.9
              }]
            })
          }]
        })
      }
    };

    await service.classifyAndApply(newMemory);
    assert.equal(reinforcementCount, 0);
    assert.equal(relationOptions?.reinforceTargetPreference, true);
  });

  it("forwards the historical cutoff to candidate search", async () => {
    const newMemory = makeMemory("new", "Historical fact");
    let searchOptions: { asOf?: string } | undefined;
    const neo4jClient = {
      semanticSearchMemories: async (options: { asOf?: string }) => {
        searchOptions = options;
        return [];
      }
    };
    const service = new RelationClassifierService(
      {
        ANTHROPIC_API_KEY: "test-key",
        ANTHROPIC_MODEL: "test-model"
      } as AppConfig,
      neo4jClient as never,
      {} as never,
      {} as never
    );

    const result = await service.classifyAndApply(newMemory, { asOf: newMemory.createdAt });
    assert.equal(result.candidateCount, 0);
    assert.equal(searchOptions?.asOf, newMemory.createdAt);
  });

  it("corrects a unique one-character UUID transcription error", async () => {
    const candidateId = "44dd897a-99a1-45df-8065-975afc1eb2d8";
    const response = JSON.stringify({
      relations: [{
        existingMemoryId: "44dd897a-9a1-45df-8065-975afc1eb2d8",
        relationType: "EXTEND",
        confidence: 0.9
      }]
    });
    const service = makeService(response);
    const result = await service.classify(
      makeMemory("new", "New fact"),
      [makeMemory(candidateId, "Existing fact")]
    );
    assert.equal(result.relations[0].existingMemoryId, candidateId);
  });

  it("rejects ambiguous one-character UUID corrections", async () => {
    const response = JSON.stringify({
      relations: [{
        existingMemoryId: "44dd897a-9a1-45df-8065-975afc1eb2d8",
        relationType: "EXTEND",
        confidence: 0.9
      }]
    });
    const service = makeService(response);
    await assert.rejects(
      service.classify(makeMemory("new", "New fact"), [
        makeMemory("44dd897a-99a1-45df-8065-975afc1eb2d8", "First"),
        makeMemory("44dd897a-a9a1-45df-8065-975afc1eb2d8", "Second")
      ]),
      /unknown existingMemoryId/
    );
  });

  it("does not repair a batch UUID against another entry's candidates", async () => {
    const response = JSON.stringify({
      classifications: [{
        newMemoryId: "new-a",
        relations: [{
          existingMemoryId: "44dd897a-9a1-45df-8065-975afc1eb2d8",
          relationType: "EXTEND",
          confidence: 0.9
        }]
      }]
    });
    const service = makeService(response);

    await assert.rejects(
      service.batchClassify([
        {
          newMemory: makeMemory("new-a", "First new fact"),
          candidates: [{
            memory: makeMemory("11111111-1111-4111-8111-111111111111", "First candidate"),
            score: 0.9
          }]
        },
        {
          newMemory: makeMemory("new-b", "Second new fact"),
          candidates: [{
            memory: makeMemory("44dd897a-99a1-45df-8065-975afc1eb2d8", "Second candidate"),
            score: 0.9
          }]
        }
      ]),
      /unknown existingMemoryId/
    );
  });
});
