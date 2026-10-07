import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import type { Session } from "neo4j-driver";

import type { AppConfig } from "../config.js";
import { Neo4jClient } from "./neo4j-client.js";

const testUri = process.env.NEO4J_TEST_URI;

// Use a disposable, unauthenticated local Neo4j; never a production database.
describe("Latest memories pagination (real Neo4j)", { skip: !testUri }, () => {
  for (const [count, pageSize] of [[1001, 500], [6, 3], [0, 3], [1, 3]] as const) {
    it(`returns all ${count} active memories in order with pages of ${pageSize}`, async () => {
      assert.ok(testUri);
      assert.match(testUri, /^bolt:\/\/127\.0\.0\.1:\d+$/);
      const client = new Neo4jClient({
        NEO4J_URI: testUri,
        NEO4J_USER: "neo4j",
        NEO4J_PASSWORD: "unused-local-test-password",
        NEO4J_MEMORY_PAGE_SIZE: pageSize
      } as AppConfig);
      const testRunId = randomUUID();
      const containerTag = "chatgpt-mcp-canary";
      const id = (index: number) => `${testRunId}-${String(index).padStart(5, "0")}`;
      // Tied timestamps span page boundaries. Insert in reverse ID order.
      const rows = Array.from({ length: count }, (_, index) => ({
        id: id(index),
        createdAt: `2026-01-${index < Math.floor(count / 2) ? "02" : "01"}T00:00:00.000000123Z`,
        containerTag,
        isLatest: true,
        forgottenAt: null as string | null
      })).reverse();
      rows.push(
        { id: id(count), createdAt: "2026-01-03T00:00:00Z", containerTag, isLatest: false, forgottenAt: null },
        { id: id(count + 1), createdAt: "2026-01-03T00:00:00Z", containerTag, isLatest: true, forgottenAt: "2026-01-04T00:00:00Z" },
        { id: id(count + 2), createdAt: "2026-01-03T00:00:00Z", containerTag: `${containerTag}-${testRunId}`, isLatest: true, forgottenAt: null }
      );
      const driver = client.getDriver();
      const setupSession = driver.session();
      try {
        await setupSession.run(`
          UNWIND $rows AS row
          CREATE (m:Memory {
            id: row.id, content: row.id, memoryType: 'fact',
            containerTag: row.containerTag, isLatest: row.isLatest,
            createdAt: datetime(row.createdAt), forgottenAt: datetime(row.forgottenAt),
            testRunId: $testRunId
          })
        `, { rows, testRunId });

        // Observe actual database responses, without fabricating query results.
        const pageLengths: number[] = [];
        const openSession = driver.session.bind(driver);
        driver.session = (...args) => {
          const session = openSession(...args);
          return new Proxy(session, {
            get(target, property) {
              if (property === "run") {
                return async (...runArgs: Parameters<Session["run"]>) => {
                  const result = await target.run(...runArgs);
                  pageLengths.push(result.records.length);
                  return result;
                };
              }
              const value = Reflect.get(target, property);
              return typeof value === "function" ? value.bind(target) : value;
            }
          });
        };

        const memories = await client.getLatestMemoriesByContainer(containerTag);
        assert.ok(pageLengths.every((length) => length <= pageSize), `Unbounded response: ${pageLengths}`);
        assert.deepEqual(memories.map((memory) => memory.id), Array.from({ length: count }, (_, index) => id(index)));
        assert.equal(pageLengths.length, Math.floor(count / pageSize) + 1);
      } finally {
        try {
          await setupSession.run("MATCH (m:Memory {testRunId: $testRunId}) DELETE m", { testRunId });
        } finally {
          await setupSession.close();
          await client.close();
        }
      }
    });
  }
});
