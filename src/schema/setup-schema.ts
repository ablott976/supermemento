import type { Driver } from "neo4j-driver";
import neo4j from "neo4j-driver";

const CONSTRAINTS_AND_INDEXES = [
  "CREATE CONSTRAINT memory_id IF NOT EXISTS FOR (m:Memory) REQUIRE m.id IS UNIQUE",
  "CREATE CONSTRAINT document_id IF NOT EXISTS FOR (d:Document) REQUIRE d.id IS UNIQUE",
  "CREATE CONSTRAINT chunk_id IF NOT EXISTS FOR (c:Chunk) REQUIRE c.id IS UNIQUE",
  "CREATE CONSTRAINT profile_container IF NOT EXISTS FOR (p:Profile) REQUIRE p.containerTag IS UNIQUE",
  "CREATE CONSTRAINT container_config_tag IF NOT EXISTS FOR (c:ContainerConfig) REQUIRE c.containerTag IS UNIQUE",
  "CREATE INDEX memory_container IF NOT EXISTS FOR (m:Memory) ON (m.containerTag)",
  "CREATE INDEX memory_latest IF NOT EXISTS FOR (m:Memory) ON (m.isLatest)",
  "CREATE INDEX memory_type IF NOT EXISTS FOR (m:Memory) ON (m.memoryType)",
  "CREATE INDEX memory_container_latest_type IF NOT EXISTS FOR (m:Memory) ON (m.containerTag, m.isLatest, m.memoryType)",
  "CREATE INDEX document_status IF NOT EXISTS FOR (d:Document) ON (d.status)"
] as const;

/**
 * Creates the required Neo4j constraints and indexes for Memento v2.
 * The operation is idempotent.
 * @param driver Neo4j driver instance.
 */
export async function setupSchema(driver: Driver): Promise<void> {
  const session = driver.session();
  try {
    for (const statement of CONSTRAINTS_AND_INDEXES) {
      await session.run(statement);
    }

    await ensureVectorIndex(session, "memory_embeddings", "Memory", "embedding");
    await ensureVectorIndex(session, "chunk_embeddings", "Chunk", "embedding");
  } finally {
    await session.close();
  }
}

/**
 * Runs schema setup using environment-based configuration.
 */
export async function runSetupSchema(): Promise<void> {
  const uri = process.env.NEO4J_URI;
  const user = process.env.NEO4J_USER;
  const password = process.env.NEO4J_PASSWORD;

  if (!uri || !user || !password) {
    throw new Error("NEO4J_URI, NEO4J_USER, and NEO4J_PASSWORD are required for schema setup");
  }

  const driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
  try {
    await driver.verifyConnectivity();
    await setupSchema(driver);
  } finally {
    await driver.close();
  }
}

async function ensureVectorIndex(
  session: ReturnType<Driver["session"]>,
  indexName: string,
  label: string,
  property: string
): Promise<void> {
  const lookup = await session.run(
    "SHOW INDEXES YIELD name WHERE name = $name RETURN count(*) AS count",
    { name: indexName }
  );

  const count = Number(lookup.records[0]?.get("count") ?? 0);
  if (count > 0) {
    return;
  }

  await session.run(
    `CREATE VECTOR INDEX ${indexName} IF NOT EXISTS FOR (n:${label}) ON (n.${property}) OPTIONS { indexConfig: { \`vector.dimensions\`: 3072, \`vector.similarity_function\`: 'cosine' } }`
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runSetupSchema().catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  });
}
