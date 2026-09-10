import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  isInitializeRequest,
  type CallToolResult,
  type ListToolsResult
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { loadConfig } from "./config.js";
import { Neo4jClient } from "./db/neo4j-client.js";
import { setupSchema } from "./schema/setup-schema.js";
import { EmbeddingService } from "./services/embedding.js";
import { ForgettingService } from "./services/forgetting.js";
import { IngestionPipeline } from "./services/ingestion/pipeline.js";
import { MemoryExtractorService } from "./services/ingestion/memory-extractor.js";
import { ProfileService } from "./services/profiles/profile-service.js";
import { RelationClassifierService } from "./services/relation-classifier.js";
import { SearchService } from "./services/search/search-service.js";
import { WebCrawlerConnector } from "./services/connectors/web-crawler.js";
import {
  TEMPORAL_CLASSES,
  VALID_TO_METADATA_KEY,
  assertValidToForTemporalClass,
  memoryContentHash,
  resolveTemporalClass,
  withTemporalClass,
  type TemporalClass
} from "./services/memory-policy.js";
import { ContentType, DocumentStatus, MemoryType, RelationType, type Memory, type Metadata } from "./types/index.js";

/** Accept both "YYYY-MM-DD" and full ISO datetime, normalising date-only to midnight UTC */
const flexibleDatetime = z.string().transform((v) => {
  if (!v) return v;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v + "T00:00:00Z";
  return v;
}).pipe(z.string().datetime()).optional();

/** Declared by whoever creates the memory. Anything but "none" requires validTo (server-enforced). */
const temporalClassSchema = z.enum(TEMPORAL_CLASSES).optional();

const createMemoryArgsSchema = z.object({
  content: z.string().min(1),
  memoryType: z.nativeEnum(MemoryType),
  containerTag: z.string().min(1),
  sourceDocId: z.string().uuid().optional(),
  metadata: z.record(z.unknown()).optional(),
  confidence: z.number().min(0).max(1).default(0.9),
  validFrom: flexibleDatetime,
  validTo: flexibleDatetime,
  temporal_class: temporalClassSchema
});

export const createMemoryInputSchema = zodToJsonSchema(createMemoryArgsSchema);

const batchMemoryItemSchema = z.object({
  content: z.string().min(1),
  metadata: z.record(z.unknown()).optional(),
  memoryType: z.nativeEnum(MemoryType),
  confidence: z.number().min(0).max(1).default(0.9),
  validFrom: flexibleDatetime,
  validTo: flexibleDatetime,
  temporal_class: temporalClassSchema
});

const batchCreateMemoriesArgsSchema = z.object({
  memories: z.array(batchMemoryItemSchema).min(1).max(50),
  containerTag: z.string().min(1),
  sourceDocId: z.string().uuid().optional()
});

export const batchCreateMemoriesInputSchema = zodToJsonSchema(batchCreateMemoriesArgsSchema);

const semanticSearchArgsSchema = z.object({
  query: z.string().min(1),
  containerTag: z.string().min(1).optional(),
  searchMode: z.enum(["memory", "rag", "hybrid"]).default("hybrid"),
  rerank: z.boolean().default(false),
  rewriteQuery: z.boolean().default(false),
  limit: z.number().int().min(1).max(100).default(10),
  min_similarity: z.number().min(0).max(1).default(0.6),
  memoryTypes: z.array(z.nativeEnum(MemoryType)).optional(),
  includeExpired: z.boolean().default(false)
});

const createDocumentArgsSchema = z.object({
  title: z.string().min(1),
  contentType: z.nativeEnum(ContentType),
  rawContent: z.string().default(""),
  containerTag: z.string().min(1),
  metadata: z.record(z.unknown()).optional(),
  sourceUrl: z.string().url().optional(),
  filePath: z.string().optional()
});

/** Ingestion tools share the memory policy: temporal_class plus the default validTo for extracted memories. */
const ingestPolicyFields = {
  metadata: z.record(z.unknown()).optional(),
  temporal_class: temporalClassSchema,
  validTo: flexibleDatetime
};

const ingestDocumentArgsSchema = z.object({
  content: z.string().min(1),
  contentType: z.nativeEnum(ContentType),
  containerTag: z.string().min(1),
  title: z.string().min(1).optional(),
  ...ingestPolicyFields
});

const ingestUrlArgsSchema = z.object({
  url: z.string().url(),
  containerTag: z.string().min(1),
  title: z.string().min(1).optional(),
  ...ingestPolicyFields
});

const ingestConversationArgsSchema = z.object({
  messages: z.array(
    z.object({
      speaker: z.string().min(1),
      message: z.string().min(1)
    })
  ),
  containerTag: z.string().min(1),
  title: z.string().min(1).optional(),
  ...ingestPolicyFields
});

const getDocumentStatusArgsSchema = z.object({
  documentId: z.string().uuid()
});

const deleteDocumentArgsSchema = z.object({
  documentId: z.string().uuid()
});

const updateDocumentArgsSchema = z.object({
  documentId: z.string().uuid(),
  title: z.string().min(1).optional(),
  rawContent: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  status: z.nativeEnum(DocumentStatus).optional()
});

const listDocumentsArgsSchema = z.object({
  containerTag: z.string().min(1).optional(),
  status: z.nativeEnum(DocumentStatus).optional(),
  limit: z.number().int().min(1).max(200).default(50)
});

const listMemoriesArgsSchema = z.object({
  containerTag: z.string().min(1).optional(),
  memoryType: z.nativeEnum(MemoryType).optional(),
  isLatest: z.boolean().optional(),
  limit: z.number().int().min(1).max(200).default(50)
});

const deleteMemoryArgsSchema = z.object({
  memoryId: z.string().uuid()
});

const updateMemoryArgsSchema = z.object({
  memoryId: z.string().uuid(),
  metadata: z.record(z.unknown()).optional(),
  content: z.string().min(1).optional(),
  memoryType: z.nativeEnum(MemoryType).optional(),
  isLatest: z.boolean().optional(),
  confidence: z.number().min(0).max(1).optional(),
  validFrom: flexibleDatetime.unwrap().nullable().optional(),
  validTo: flexibleDatetime.unwrap().nullable().optional(),
  forgottenAt: flexibleDatetime.unwrap().nullable().optional()
});

export const updateMemoryInputSchema = zodToJsonSchema(updateMemoryArgsSchema);

const getMemoryRelationsArgsSchema = z.object({
  memoryId: z.string().uuid()
});

const createMemoryRelationArgsSchema = z.object({
  fromMemoryId: z.string().uuid(),
  toMemoryId: z.string().uuid(),
  relationType: z.enum([RelationType.Updates, RelationType.Extends, RelationType.Derives])
});

const forgetMemoryArgsSchema = z.object({
  memoryId: z.string().uuid()
});

const reinforcePreferenceArgsSchema = z.object({
  memoryId: z.string().uuid()
});

const getUserProfileArgsSchema = z.object({
  containerTag: z.string().min(1),
  regenerate: z.boolean().default(false),
  includeSearch: z.boolean().default(false)
});

const crawlUrlArgsSchema = z.object({
  url: z.string().url(),
  containerTag: z.string().min(1),
  temporal_class: temporalClassSchema,
  validTo: flexibleDatetime
});

const crawlUrlsArgsSchema = z.object({
  urls: z.array(z.string().url()).min(1).max(20),
  containerTag: z.string().min(1),
  temporal_class: temporalClassSchema,
  validTo: flexibleDatetime
});

const listCrawledUrlsArgsSchema = z.object({
  containerTag: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(500).default(100)
});

/** Strip embedding field from a record to reduce response size. */
function stripEmbedding(obj: Record<string, unknown>): Record<string, unknown> {
  const { embedding, ...rest } = obj;
  return rest;
}

/**
 * Resolves and validates the temporal policy of an ingestion/crawl call and returns the
 * document metadata that carries it into the pipeline.
 */
function ingestionPolicyMetadata(input: {
  metadata?: Metadata;
  temporal_class?: TemporalClass;
  validTo?: string;
}): Metadata {
  const temporalClass = resolveTemporalClass(input.temporal_class, input.metadata);
  assertValidToForTemporalClass(temporalClass, input.validTo);
  const metadata = withTemporalClass(input.metadata, temporalClass);
  if (input.validTo) {
    metadata[VALID_TO_METADATA_KEY] = input.validTo;
  }
  return metadata;
}

const DEFAULT_DEDUP_SEMANTIC_THRESHOLD = 0.95;
const DEFAULT_DEDUP_SEMANTIC_LIMIT = 3;

/** Supermemento MCP server implementation. */
export class SupermementoServer {
  private readonly server: Server;
  private readonly neo4jClient: Neo4jClient;
  private readonly embeddingService: EmbeddingService;
  private readonly relationClassifierService: RelationClassifierService;
  private readonly forgettingService: ForgettingService;
  private readonly memoryExtractorService: MemoryExtractorService;
  private readonly ingestionPipeline: IngestionPipeline;
  private readonly searchService: SearchService;
  private readonly profileService: ProfileService;
  private readonly dedupSemanticThreshold: number;
  private readonly dedupSemanticLimit: number;

  /**
   * Creates the MCP server and internal services.
   */
  public constructor() {
    const config = loadConfig();
    this.dedupSemanticThreshold = config.DEDUP_SEMANTIC_THRESHOLD;
    this.dedupSemanticLimit = config.DEDUP_SEMANTIC_LIMIT;
    this.neo4jClient = new Neo4jClient(config);
    this.embeddingService = new EmbeddingService(config);
    this.forgettingService = new ForgettingService(this.neo4jClient);
    this.relationClassifierService = new RelationClassifierService(
      config,
      this.neo4jClient,
      this.embeddingService,
      this.forgettingService
    );
    this.memoryExtractorService = new MemoryExtractorService(config);
    this.ingestionPipeline = new IngestionPipeline(
      this.neo4jClient,
      this.embeddingService,
      this.relationClassifierService,
      this.memoryExtractorService
    );
    this.searchService = new SearchService(config, this.neo4jClient, this.embeddingService);
    this.profileService = new ProfileService(config, this.neo4jClient);

    this.server = new Server(
      {
        name: "supermemento-mcp",
        version: "0.2.0"
      },
      {
        capabilities: {
          tools: {}
        }
      }
    );

    this.registerHandlersOnServer(this.server);
  }

  /**
   * Starts the server on stdio transport.
   */
  public async startStdio(): Promise<void> {
    await this.neo4jClient.verifyConnectivity();
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }

  /**
   * Starts the server on HTTP/SSE + Streamable HTTP transport.
   * @param port Port to listen on (default 8080).
   * @param host Host to bind to (default 0.0.0.0).
   */
  public async startSSE(port = 8080, host = "0.0.0.0"): Promise<void> {
    await this.neo4jClient.verifyConnectivity();

    // Shared transport map for both SSE and Streamable HTTP sessions
    const transports = new Map<string, SSEServerTransport | StreamableHTTPServerTransport>();

    /** Parse JSON body from raw IncomingMessage (no Express body-parser). */
    const parseJsonBody = (req: IncomingMessage): Promise<unknown> =>
      new Promise((resolve, reject) => {
        let body = "";
        req.on("data", (chunk: Buffer | string) => (body += chunk));
        req.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(e);
          }
        });
        req.on("error", reject);
      });

    const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

      // CORS headers
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, mcp-session-id");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      // Health check
      if (url.pathname === "/health" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", version: "0.2.0", transports: ["sse", "streamable-http"] }));
        return;
      }

      // ── Streamable HTTP transport (/mcp) ─────────────────────────
      if (url.pathname === "/mcp") {
        try {
          const sessionId = req.headers["mcp-session-id"] as string | undefined;
          let transport: StreamableHTTPServerTransport | undefined;

          if (sessionId && transports.has(sessionId)) {
            const existing = transports.get(sessionId);
            if (existing instanceof StreamableHTTPServerTransport) {
              transport = existing;
            } else {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({
                jsonrpc: "2.0",
                error: { code: -32000, message: "Bad Request: Session uses a different transport protocol" },
                id: null
              }));
              return;
            }
          } else if (!sessionId && req.method === "POST") {
            // Parse body to check if it's an initialize request
            const body = await parseJsonBody(req);
            if (isInitializeRequest(body)) {
              transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: () => randomUUID(),
                onsessioninitialized: (sid: string) => {
                  console.log(`[supermemento] Streamable HTTP session initialized: ${sid}`);
                  transports.set(sid, transport!);
                }
              });

              transport.onclose = () => {
                const sid = transport!.sessionId;
                if (sid && transports.has(sid)) {
                  console.log(`[supermemento] Streamable HTTP session closed: ${sid}`);
                  transports.delete(sid);
                }
              };

              // Each Streamable HTTP session gets its own Server instance
              const sessionServer = new Server(
                { name: "supermemento-mcp", version: "0.2.0" },
                { capabilities: { tools: {} } }
              );
              this.registerHandlersOnServer(sessionServer);
              await sessionServer.connect(transport);

              // Handle the request with pre-parsed body
              await transport.handleRequest(req, res, body);
              return;
            } else {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({
                jsonrpc: "2.0",
                error: { code: -32600, message: "Bad Request: First request must be an initialize request" },
                id: null
              }));
              return;
            }
          } else if (sessionId && !transports.has(sessionId)) {
            // Session not found
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
              jsonrpc: "2.0",
              error: { code: -32001, message: "Session not found" },
              id: null
            }));
            return;
          } else {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
              jsonrpc: "2.0",
              error: { code: -32600, message: "Bad Request: No valid session ID provided" },
              id: null
            }));
            return;
          }

          // For existing sessions, parse body for POST, then delegate
          if (req.method === "POST") {
            const body = await parseJsonBody(req);
            await transport.handleRequest(req, res, body);
          } else {
            // GET (SSE stream) or DELETE (close session)
            await transport.handleRequest(req, res);
          }
        } catch (error) {
          console.error("[supermemento] Streamable HTTP error:", error);
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
              jsonrpc: "2.0",
              error: { code: -32603, message: "Internal server error" },
              id: null
            }));
          }
        }
        return;
      }
      // ─────────────────────────────────────────────────────────────

      // ── Legacy SSE transport (/sse + /messages) ──────────────────
      if (url.pathname === "/sse" && req.method === "GET") {
        try {
          const baseUrl = process.env.PUBLIC_URL ?? `http://${req.headers.host ?? "localhost"}`;
          const transport = new SSEServerTransport(`${baseUrl}/messages`, res);
          transports.set(transport.sessionId, transport);
          console.log(`[supermemento] New SSE session: ${transport.sessionId}`);

          transport.onclose = () => {
            console.log(`[supermemento] SSE session closed: ${transport.sessionId}`);
            transports.delete(transport.sessionId);
          };

          const sessionServer = new Server(
            { name: "supermemento-mcp", version: "0.2.0" },
            { capabilities: { tools: {} } }
          );
          this.registerHandlersOnServer(sessionServer);
          await sessionServer.connect(transport);
        } catch (error) {
          console.error("[supermemento] SSE connection error:", error);
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Internal server error" }));
          }
        }
        return;
      }

      if (url.pathname === "/messages" && req.method === "POST") {
        const sessionId = url.searchParams.get("sessionId");
        if (!sessionId || !transports.has(sessionId)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid or missing sessionId" }));
          return;
        }
        const transport = transports.get(sessionId);
        if (!(transport instanceof SSEServerTransport)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Session uses a different transport protocol" }));
          return;
        }
        try {
          await transport.handlePostMessage(req, res);
        } catch (error) {
          console.error("[supermemento] Message handling error:", error);
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Internal server error" }));
          }
        }
        return;
      }
      // ─────────────────────────────────────────────────────────────

      // ── OAuth 2.0 endpoints for Claude.ai compatibility ──────────
      const publicUrl = process.env.PUBLIC_URL ?? `http://${req.headers.host ?? "localhost"}`;

      if (url.pathname === "/.well-known/oauth-protected-resource") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ resource: publicUrl, authorization_servers: [publicUrl] }));
        return;
      }
      if (url.pathname === "/.well-known/oauth-authorization-server") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          issuer: publicUrl,
          authorization_endpoint: `${publicUrl}/oauth/authorize`,
          token_endpoint: `${publicUrl}/oauth/token`,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code"],
          code_challenge_methods_supported: ["S256"],
          scopes_supported: ["mcp"]
        }));
        return;
      }
      if (url.pathname === "/oauth/authorize") {
        const redirectUri = url.searchParams.get("redirect_uri");
        const state = url.searchParams.get("state");
        try {
          const redir = new URL(redirectUri!);
          redir.searchParams.set("code", "sm-" + Date.now());
          if (state) redir.searchParams.set("state", state);
          res.writeHead(302, { Location: redir.toString() });
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "invalid_redirect_uri" }));
        }
        res.end();
        return;
      }
      if (url.pathname === "/oauth/token") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          access_token: "sm-open-" + Date.now(),
          token_type: "Bearer",
          expires_in: 86400,
          scope: "mcp"
        }));
        return;
      }
      // ─────────────────────────────────────────────────────────────

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    });

    httpServer.listen(port, host, () => {
      console.log(`[supermemento] Server listening on http://${host}:${port}`);
      console.log(`[supermemento] Streamable HTTP endpoint: /mcp (GET, POST, DELETE)`);
      console.log(`[supermemento] Legacy SSE endpoint: GET /sse`);
      console.log(`[supermemento] Legacy message endpoint: POST /messages`);
      console.log(`[supermemento] Health: GET /health`);
    });
  }

  /**
   * Closes all external resources.
   */
  public async close(): Promise<void> {
    await this.neo4jClient.close();
  }

  /**
   * Returns the id of the per-container catch-all document for manual memories, creating it once.
   * @param containerTag Container namespace.
   */
  private async resolveManualMemoriesDocument(containerTag: string): Promise<string> {
    const catchAllTitle = "Manual memories: " + containerTag;
    const existing = await this.neo4jClient.listDocuments({
      containerTag,
      status: DocumentStatus.Done,
      limit: 200
    });
    const catchAll = existing.find((d) => d.title === catchAllTitle);
    if (catchAll) {
      return catchAll.id;
    }
    const newDoc = await this.neo4jClient.createDocument({
      title: catchAllTitle,
      contentType: ContentType.Text,
      rawContent: "Auto-created for manual memories",
      containerTag
    });
    await this.neo4jClient.updateDocument(newDoc.id, { status: DocumentStatus.Done });
    return newDoc.id;
  }

  /**
   * Semantic near-duplicate warning for human review. Never merges or blocks: it only reports
   * active memories in the same container whose cosine similarity reaches the configured threshold.
   * @param memory Memory just created (its own id is excluded).
   */
  private async findPossibleDuplicates(memory: Memory): Promise<Array<{ id: string; score: number; content: string }>> {
    try {
      const hits = await this.neo4jClient.semanticSearchMemoriesAdvanced({
        embedding: memory.embedding,
        containerTag: memory.containerTag,
        minScore: this.dedupSemanticThreshold ?? DEFAULT_DEDUP_SEMANTIC_THRESHOLD,
        limit: (this.dedupSemanticLimit ?? DEFAULT_DEDUP_SEMANTIC_LIMIT) + 1,
        isLatestOnly: true
      });
      return hits
        .filter((hit) => hit.memory.id !== memory.id)
        .slice(0, this.dedupSemanticLimit ?? DEFAULT_DEDUP_SEMANTIC_LIMIT)
        .map((hit) => ({ id: hit.memory.id, score: Number(hit.score.toFixed(4)), content: hit.memory.content }));
    } catch (error) {
      console.warn(`[supermemento] possible_duplicate check skipped for ${memory.id}:`, (error as Error).message);
      return [];
    }
  }

  private registerHandlersOnServer(targetServer: Server): void {
    targetServer.setRequestHandler(ListToolsRequestSchema, async (): Promise<ListToolsResult> => ({
      tools: [
        {
          name: "create_memory",
          description:
            "Create a SINGLE Memory node. For 2+ memories use batch_create_memories instead — it is much faster. " +
            "sourceDocId is optional - if omitted, a catch-all document is auto-created for the containerTag. " +
            "metadata is an optional JSON object stored on the memory. " +
            "validFrom and validTo are optional and accept YYYY-MM-DD or an ISO datetime. " +
            "temporal_class (pricing|roadmap|pipeline|none, default none) declares expiring intelligence: " +
            "any class other than none REQUIRES validTo or the call is rejected. " +
            "Exact duplicates (same containerTag and normalised content as an active memory) are not created: " +
            "the response is {created:false, duplicateOf}. Near-duplicates are only reported as possibleDuplicates.",
          inputSchema: createMemoryInputSchema
        },
        {
          name: "batch_create_memories",
          description:
            "Create MULTIPLE memories at once (1-50). MUCH FASTER than calling create_memory repeatedly. " +
            "All memories share the same containerTag. Relation classification runs async in the background. " +
            "Use this whenever the user wants to save multiple facts, preferences, or episodes. " +
            "Each memory item has: content (required), memoryType (fact|preference|episode|derived), " +
            "confidence (default 0.9), metadata (optional JSON object), validFrom (optional), validTo (optional), " +
            "temporal_class (pricing|roadmap|pipeline|none; any class other than none REQUIRES validTo). " +
            "Exact duplicates inside the batch or against active memories are skipped and listed in duplicates[].",
          inputSchema: batchCreateMemoriesInputSchema
        },
        {
          name: "semantic_search",
          description: "SuperRAG semantic search with memory/rag/hybrid modes, rewriting, and reranking",
          inputSchema: zodToJsonSchema(semanticSearchArgsSchema)
        },
        {
          name: "create_document",
          description: "Create a Document node with queued status",
          inputSchema: zodToJsonSchema(createDocumentArgsSchema)
        },
        {
          name: "ingest_document",
          description: "Ingest through the extraction/chunking/memory/index pipeline. For pdf, content accepts base64 PDF bytes or a public HTTP(S) PDF URL. For url, content is a public HTTP(S) URL. For text, content is plain text or Markdown. URL downloads are size/time limited and cannot access private networks. temporal_class (pricing|roadmap|pipeline|none) and validTo apply to every extracted memory: a class other than none requires validTo. Exact duplicates are not stored.",
          inputSchema: zodToJsonSchema(ingestDocumentArgsSchema)
        },
        {
          name: "ingest_url",
          description: "Fetch URL content and run the full ingestion pipeline. temporal_class (pricing|roadmap|pipeline|none) and validTo apply to every extracted memory; a class other than none requires validTo. Exact duplicates are not stored.",
          inputSchema: zodToJsonSchema(ingestUrlArgsSchema)
        },
        {
          name: "ingest_conversation",
          description: "Ingest conversation messages and run full pipeline. temporal_class (pricing|roadmap|pipeline|none) and validTo apply to every extracted memory; a class other than none requires validTo. Exact duplicates are not stored.",
          inputSchema: zodToJsonSchema(ingestConversationArgsSchema)
        },
        {
          name: "get_document_status",
          description: "Get the processing status for a document",
          inputSchema: zodToJsonSchema(getDocumentStatusArgsSchema)
        },
        {
          name: "delete_document",
          description: "Delete a document by ID (hard delete)",
          inputSchema: zodToJsonSchema(deleteDocumentArgsSchema)
        },
        {
          name: "update_document",
          description: "Update mutable fields on a document by ID",
          inputSchema: zodToJsonSchema(updateDocumentArgsSchema)
        },
        {
          name: "list_documents",
          description: "List documents filtered by containerTag and optional status",
          inputSchema: zodToJsonSchema(listDocumentsArgsSchema)
        },
        {
          name: "list_memories",
          description: "List memories filtered by containerTag, memoryType, and latest flag",
          inputSchema: zodToJsonSchema(listMemoriesArgsSchema)
        },
        {
          name: "delete_memory",
          description: "Delete a memory by ID",
          inputSchema: zodToJsonSchema(deleteMemoryArgsSchema)
        },
        {
          name: "update_memory",
          description: "Update mutable fields on a memory by ID. metadata replaces the entire object; omit to preserve it or pass {} to clear it.",
          inputSchema: updateMemoryInputSchema
        },
        {
          name: "get_memory_relations",
          description: "Get all relations connected to a memory",
          inputSchema: zodToJsonSchema(getMemoryRelationsArgsSchema)
        },
        {
          name: "create_memory_relation",
          description: "Link two existing memories in the same container. UPDATES points from the replacement to the old memory and marks the old memory not latest. EXTENDS adds detail; DERIVES links a derived memory to its source. Repeated links are not duplicated.",
          inputSchema: zodToJsonSchema(createMemoryRelationArgsSchema)
        },
        {
          name: "run_maintenance",
          description: "Run automatic forgetting maintenance cycle",
          inputSchema: {
            type: "object",
            properties: {},
            additionalProperties: false
          }
        },
        {
          name: "forget_memory",
          description: "Manually soft-delete a memory by ID",
          inputSchema: zodToJsonSchema(forgetMemoryArgsSchema)
        },
        {
          name: "reinforce_preference",
          description: "Increase confidence for a preference memory by ID",
          inputSchema: zodToJsonSchema(reinforcePreferenceArgsSchema)
        },
        {
          name: "get_user_profile",
          description: "Get or regenerate static+dynamic user profile",
          inputSchema: zodToJsonSchema(getUserProfileArgsSchema)
        },
        {
          name: "crawl_url",
          description: "One-shot crawl of a URL and ingest if changed. temporal_class (pricing|roadmap|pipeline|none) and validTo apply to every extracted memory; a class other than none requires validTo.",
          inputSchema: zodToJsonSchema(crawlUrlArgsSchema)
        },
        {
          name: "crawl_urls",
          description: "Batch crawl multiple URLs and ingest changed content. temporal_class (pricing|roadmap|pipeline|none) and validTo apply to every extracted memory; a class other than none requires validTo.",
          inputSchema: zodToJsonSchema(crawlUrlsArgsSchema)
        },
        {
          name: "list_crawled_urls",
          description: "List URLs that have been crawled with last crawl date",
          inputSchema: zodToJsonSchema(listCrawledUrlsArgsSchema)
        },
        {
          name: "setup_schema",
          description: "Run idempotent Neo4j constraints and index setup",
          inputSchema: {
            type: "object",
            properties: {},
            additionalProperties: false
          }
        }
      ]
    }));

    targetServer.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
      const name = request.params.name;
      const args = request.params.arguments ?? {};
      try {
        console.log(`[supermemento] Tool call: ${name} args=${JSON.stringify(args).substring(0, 300)}`);

        switch (name) {
          case "create_memory": {
            const input = createMemoryArgsSchema.parse(args);
            // Policy first, before any write: temporal intelligence needs validTo; exact duplicates are not created.
            const temporalClass = resolveTemporalClass(input.temporal_class, input.metadata);
            assertValidToForTemporalClass(temporalClass, input.validTo);
            const metadata = withTemporalClass(input.metadata, temporalClass);
            const contentHash = memoryContentHash(input.containerTag, input.content);
            const duplicate = await this.neo4jClient.findActiveMemoryByContentHash(input.containerTag, contentHash);
            if (duplicate) {
              return asJson({
                created: false,
                duplicateOf: duplicate.id,
                memory: stripEmbedding(duplicate as unknown as Record<string, unknown>)
              });
            }
            const sourceDocId = input.sourceDocId ?? await this.resolveManualMemoriesDocument(input.containerTag);
            const embedding = await this.embeddingService.generateEmbedding(input.content);
            const memory = await this.neo4jClient.createMemory({
              metadata,
              content: input.content,
              memoryType: input.memoryType,
              containerTag: input.containerTag,
              confidence: input.confidence,
              sourceDocId,
              embedding,
              validFrom: input.validFrom,
              validTo: input.validTo
            });
            // Relation classification runs async — no longer blocks the response
            this.relationClassifierService.classifyAndApply(memory)
              .then((r) => console.log(`[supermemento] Async relation done: ${memory.id}`, JSON.stringify(r)))
              .catch((e) => console.warn(`[supermemento] Async relation skipped:`, (e as Error).message));
            const possibleDuplicates = await this.findPossibleDuplicates(memory);
            const { embedding: _emb, ...memoryClean } = memory;
            return asJson({
              created: true,
              memory: memoryClean,
              relationClassification: "async",
              ...(possibleDuplicates.length > 0 ? { possibleDuplicates } : {})
            });
          }

          case "batch_create_memories": {
            const input = batchCreateMemoriesArgsSchema.parse(args);

            // 1. Policy for every item before any write: the whole batch is rejected on the first invalid item.
            const prepared = input.memories.map((m, index) => {
              try {
                const temporalClass = resolveTemporalClass(m.temporal_class, m.metadata);
                assertValidToForTemporalClass(temporalClass, m.validTo);
                return {
                  ...m,
                  index,
                  metadata: withTemporalClass(m.metadata, temporalClass),
                  contentHash: memoryContentHash(input.containerTag, m.content)
                };
              } catch (error) {
                throw new Error(`memories[${index}]: ${(error as Error).message}`);
              }
            });

            // 2. Exact dedup: inside the batch (first occurrence wins) and against active memories.
            const duplicates: Array<{ index: number; duplicateOf: string }> = [];
            const pendingIntraBatch: Array<{ index: number; ownerIndex: number }> = [];
            const ownerByHash = new Map<string, number>();
            const toCreate: typeof prepared = [];
            for (const item of prepared) {
              const ownerIndex = ownerByHash.get(item.contentHash);
              if (ownerIndex !== undefined) {
                pendingIntraBatch.push({ index: item.index, ownerIndex });
                continue;
              }
              const existing = await this.neo4jClient.findActiveMemoryByContentHash(input.containerTag, item.contentHash);
              if (existing) {
                duplicates.push({ index: item.index, duplicateOf: existing.id });
                continue;
              }
              ownerByHash.set(item.contentHash, item.index);
              toCreate.push(item);
            }

            let createdMemories: Memory[] = [];
            if (toCreate.length > 0) {
              // 3. Resolve sourceDocId (catch-all document pattern) only when something will be written.
              const sourceDocId = input.sourceDocId ?? await this.resolveManualMemoriesDocument(input.containerTag);

              // 4. Batch embedding — 1 API call for the memories that will be stored
              const embeddings = await this.embeddingService.generateEmbeddings(toCreate.map((m) => m.content));

              // 5. Batch create memories — 1 Neo4j UNWIND transaction
              const memoryInputs = toCreate.map((m, i) => ({
                metadata: m.metadata,
                content: m.content,
                memoryType: m.memoryType,
                containerTag: input.containerTag,
                confidence: m.confidence,
                sourceDocId,
                embedding: embeddings[i] ?? [],
                validFrom: m.validFrom ?? null,
                validTo: m.validTo ?? null
              } as Parameters<typeof this.neo4jClient.batchCreateMemories>[0][number]));
              createdMemories = await this.neo4jClient.batchCreateMemories(memoryInputs);

              // 6. Batch relation classification — async fire-and-forget
              this.relationClassifierService.batchClassifyAndApply(createdMemories)
                .then(() => console.log(`[supermemento] Batch async relation done: ${createdMemories.length} memories`))
                .catch((e) => console.warn(`[supermemento] Batch async relation skipped:`, (e as Error).message));
            }

            const createdIdByIndex = new Map(toCreate.map((item, i) => [item.index, createdMemories[i]?.id ?? ""]));
            for (const pending of pendingIntraBatch) {
              duplicates.push({ index: pending.index, duplicateOf: createdIdByIndex.get(pending.ownerIndex) ?? "" });
            }
            duplicates.sort((a, b) => a.index - b.index);

            // 7. Return cleaned results (strip embedding vectors)
            const cleaned = createdMemories.map(({ embedding: _emb, ...rest }) => rest);
            return asJson({
              count: cleaned.length,
              memories: cleaned,
              duplicates,
              message: `${cleaned.length} memories created, ${duplicates.length} exact duplicates skipped. Relation classification running in background.`
            });
          }

          case "semantic_search": {
            const input = semanticSearchArgsSchema.parse(args);
            const response = await this.searchService.search(input);
            return asJson(response);
          }

          case "create_document": {
            const input = createDocumentArgsSchema.parse(args);
            const document = await this.neo4jClient.createDocument({
              title: input.title,
              contentType: input.contentType,
              rawContent: input.rawContent,
              containerTag: input.containerTag,
              metadata: input.metadata,
              sourceUrl: input.sourceUrl,
              filePath: input.filePath
            });
            return asJson({ document });
          }

          case "ingest_document": {
            const input = ingestDocumentArgsSchema.parse(args);
            const metadata = ingestionPolicyMetadata(input);
            const doc = await this.neo4jClient.createDocument({
              title: input.title ?? `Ingested ${input.contentType}`,
              contentType: input.contentType,
              rawContent: input.content,
              containerTag: input.containerTag,
              metadata
            });
            this.ingestionPipeline.processDocument(doc.id)
              .then((r) => console.log(`[supermemento] Async ingest done: ${doc.id} chunks=${r.chunkCount} memories=${r.memoryCount}`))
              .catch((e) => console.error(`[supermemento] Async ingest failed: ${doc.id} ${(e as Error).message}`));
            return asJson({
              document: { id: doc.id, title: doc.title, containerTag: doc.containerTag, status: "processing" },
              message: `Document queued. Use get_document_status with documentId ${doc.id} to check progress.`
            });
          }

          case "ingest_url": {
            const input = ingestUrlArgsSchema.parse(args);
            const metadata = ingestionPolicyMetadata(input);
            const doc = await this.neo4jClient.createDocument({
              title: input.title ?? input.url,
              contentType: ContentType.Url,
              rawContent: input.url,
              containerTag: input.containerTag,
              sourceUrl: input.url,
              metadata
            });
            this.ingestionPipeline.processDocument(doc.id)
              .then((r) => console.log(`[supermemento] Async ingest_url done: ${doc.id} chunks=${r.chunkCount} memories=${r.memoryCount}`))
              .catch((e) => console.error(`[supermemento] Async ingest_url failed: ${doc.id} ${(e as Error).message}`));
            return asJson({
              document: { id: doc.id, title: doc.title, containerTag: doc.containerTag, status: "processing" },
              status: "processing",
              message: "URL queued. Use get_document_status to check progress."
            });
          }

          case "ingest_conversation": {
            const input = ingestConversationArgsSchema.parse(args);
            const metadata = ingestionPolicyMetadata(input);
            const content = input.messages.map((m) => `${m.speaker}: ${m.message}`).join("\n");
            const doc = await this.neo4jClient.createDocument({
              title: input.title ?? "Conversation Ingestion",
              contentType: ContentType.Conversation,
              rawContent: content,
              containerTag: input.containerTag,
              metadata
            });
            this.ingestionPipeline.processDocument(doc.id)
              .then((r) => console.log(`[supermemento] Async ingest_conversation done: ${doc.id} chunks=${r.chunkCount} memories=${r.memoryCount}`))
              .catch((e) => console.error(`[supermemento] Async ingest_conversation failed: ${doc.id} ${(e as Error).message}`));
            return asJson({
              document: { id: doc.id, title: doc.title, containerTag: doc.containerTag, status: "processing" },
              status: "processing",
              message: "Conversation queued. Use get_document_status to check progress."
            });
          }

          case "get_document_status": {
            const input = getDocumentStatusArgsSchema.parse(args);
            const document = await this.neo4jClient.getDocument(input.documentId);
            if (!document) {
              return asError(`Document not found: ${input.documentId}`);
            }
            return asJson({
              documentId: document.id,
              status: document.status,
              updatedAt: document.updatedAt,
              metadata: document.metadata
            });
          }

          case "delete_document": {
            const input = deleteDocumentArgsSchema.parse(args);
            const deleted = await this.neo4jClient.deleteDocument(input.documentId);
            return asJson({ documentId: input.documentId, deleted });
          }

          case "update_document": {
            const input = updateDocumentArgsSchema.parse(args);
            const document = await this.neo4jClient.updateDocument(input.documentId, {
              title: input.title,
              rawContent: input.rawContent,
              metadata: input.metadata,
              status: input.status
            });
            if (!document) {
              return asError(`Document not found: ${input.documentId}`);
            }
            return asJson({ document });
          }

          case "list_documents": {
            const input = listDocumentsArgsSchema.parse(args);
            const documents = await this.neo4jClient.listDocuments(input);
            return asJson({ count: documents.length, documents });
          }

          case "list_memories": {
            const input = listMemoriesArgsSchema.parse(args);
            const memories = await this.neo4jClient.listMemories(input);
            // Strip embeddings to avoid huge responses (3072 floats per memory)
            const cleaned = memories.map(({ embedding, ...rest }) => rest);
            return asJson({ count: cleaned.length, memories: cleaned });
          }

          case "delete_memory": {
            const input = deleteMemoryArgsSchema.parse(args);
            const deleted = await this.neo4jClient.deleteMemory(input.memoryId);
            return asJson({ memoryId: input.memoryId, deleted });
          }

          case "update_memory": {
            const input = updateMemoryArgsSchema.parse(args);
            const embedding = input.content === undefined
              ? undefined
              : await this.embeddingService.generateEmbedding(input.content);
            const memory = await this.neo4jClient.updateMemory(input.memoryId, {
              embedding,
              metadata: input.metadata,
              content: input.content,
              memoryType: input.memoryType,
              isLatest: input.isLatest,
              confidence: input.confidence,
              validFrom: input.validFrom,
              validTo: input.validTo,
              forgottenAt: input.forgottenAt
            });
            if (!memory) {
              return asError(`Memory not found: ${input.memoryId}`);
            }
            return asJson({ memory: stripEmbedding(memory as unknown as Record<string, unknown>) });
          }

          case "create_memory_relation": {
            const input = createMemoryRelationArgsSchema.parse(args);
            if (input.fromMemoryId === input.toMemoryId) return asError("Cannot link a memory to itself");
            const from = await this.neo4jClient.getMemory(input.fromMemoryId);
            const to = await this.neo4jClient.getMemory(input.toMemoryId);
            if (!from || !to) return asError("Both memories must exist");
            if (from.containerTag !== to.containerTag) return asError("Memories must share a container");
            if (from.forgottenAt || to.forgottenAt) return asError("Cannot link forgotten memories");
            const created = await this.neo4jClient.createMemoryRelation(
              input.fromMemoryId, input.toMemoryId, input.relationType,
              { markTargetNotLatest: input.relationType === RelationType.Updates }
            );
            return asJson({ ...input, created });
          }

          case "get_memory_relations": {
            const input = getMemoryRelationsArgsSchema.parse(args);
            const relations = await this.neo4jClient.getMemoryRelations(input.memoryId);
            return asJson({ memoryId: input.memoryId, count: relations.length, relations });
          }

          case "run_maintenance": {
            const stats = await this.forgettingService.runMaintenanceCycle();
            return asJson(stats);
          }

          case "forget_memory": {
            const input = forgetMemoryArgsSchema.parse(args);
            const forgotten = await this.forgettingService.forgetMemory(input.memoryId);
            return asJson({ memoryId: input.memoryId, forgotten });
          }

          case "reinforce_preference": {
            const input = reinforcePreferenceArgsSchema.parse(args);
            const memory = await this.neo4jClient.reinforcePreference(input.memoryId);
            if (!memory) {
              return asError(`Preference memory not found or unavailable: ${input.memoryId}`);
            }
            return asJson({ memory });
          }

          case "get_user_profile": {
            const input = getUserProfileArgsSchema.parse(args);
            const profile = input.regenerate
              ? await this.profileService.generateProfile(input.containerTag)
              : await this.profileService.getProfile(input.containerTag);

            if (!input.includeSearch) {
              return asJson(profile);
            }

            const related = await this.searchService.search({
              query: `${profile.static}\n${profile.dynamic}`,
              containerTag: input.containerTag,
              searchMode: "hybrid",
              limit: 5,
              min_similarity: 0.4,
              rerank: false,
              rewriteQuery: false,
              includeExpired: false
            });

            return asJson({
              ...profile,
              relatedResults: related.results
            });
          }

          case "crawl_url": {
            const input = crawlUrlArgsSchema.parse(args);
            const connector = new WebCrawlerConnector(
              this.neo4jClient,
              this.ingestionPipeline,
              [input.url],
              input.containerTag,
              ingestionPolicyMetadata(input)
            );
            const result = await connector.crawlUrl(input.url, input.containerTag);
            return asJson({ url: input.url, ...result });
          }

          case "crawl_urls": {
            const input = crawlUrlsArgsSchema.parse(args);
            const connector = new WebCrawlerConnector(
              this.neo4jClient,
              this.ingestionPipeline,
              input.urls,
              input.containerTag,
              ingestionPolicyMetadata(input)
            );
            const result = await connector.crawlUrls(input.urls, input.containerTag);
            return asJson(result);
          }

          case "list_crawled_urls": {
            const input = listCrawledUrlsArgsSchema.parse(args);
            const urls = await this.neo4jClient.listCrawledUrls(input);
            return asJson({ count: urls.length, urls });
          }

          case "setup_schema": {
            await setupSchema(this.neo4jClient.getDriver());
            return asJson({ status: "ok" });
          }

          default:
            return asError(`Unknown tool: ${name}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error ? error.stack?.split("\n").slice(0, 3).join("\n") : "";
        console.error(`[supermemento] Tool ERROR ${name}: ${message}`);
        if (stack) console.error(`[supermemento] Stack: ${stack}`);
        return asError(`[${name}] ${message}`);
      }
    });
  }
}

/**
 * Converts a zod schema to a JSON schema object accepted by MCP tool definitions.
 * @param schema zod schema.
 */
function zodToJsonSchema(
  schema: z.AnyZodObject
): { type: "object"; properties?: Record<string, object>; required?: string[]; [key: string]: unknown } {
  const shape = schema.shape;
  const properties: Record<string, object> = {};
  const required: string[] = [];

  for (const [key, value] of Object.entries(shape)) {
    const definition = mapZodType(value as z.ZodTypeAny);
    properties[key] = definition.schema;
    if (definition.required) {
      required.push(key);
    }
  }

  return {
    type: "object" as const,
    properties,
    required
  };
}

function mapZodType(
  type: z.ZodTypeAny
): { schema: Record<string, unknown>; required: boolean } {
  const optional = type instanceof z.ZodOptional || type instanceof z.ZodDefault;
  const target = type instanceof z.ZodOptional || type instanceof z.ZodDefault ? type._def.innerType : type;

  if (target instanceof z.ZodNullable) {
    return {
      schema: { anyOf: [mapZodType(target.unwrap()).schema, { type: "null" }] },
      required: !optional
    };
  }

  if (target instanceof z.ZodString) {
    return { schema: { type: "string" }, required: !optional };
  }

  if (target instanceof z.ZodNumber) {
    return { schema: { type: "number" }, required: !optional };
  }

  if (target instanceof z.ZodBoolean) {
    return { schema: { type: "boolean" }, required: !optional };
  }

  if (target instanceof z.ZodRecord) {
    return {
      schema: {
        type: "object",
        additionalProperties: true
      },
      required: !optional
    };
  }

  if (target instanceof z.ZodArray) {
    return {
      schema: {
        type: "array",
        items: mapZodType(target.element).schema
      },
      required: !optional
    };
  }

  if (target instanceof z.ZodObject) {
    return {
      schema: zodToJsonSchema(target),
      required: !optional
    };
  }

  if (target instanceof z.ZodEnum || target instanceof z.ZodNativeEnum) {
    const values =
      target instanceof z.ZodEnum
        ? [...target.options]
        : Object.values(target.enum).filter((v) => typeof v === "string");
    return {
      schema: {
        type: "string",
        enum: values
      },
      required: !optional
    };
  }

  return {
    schema: { type: "string" },
    required: !optional
  };
}

function asJson(value: unknown): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}

function asError(message: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: message }]
  };
}
