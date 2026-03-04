import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
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
import { ContentType, DocumentStatus, MemoryType } from "./types/index.js";

const createMemoryArgsSchema = z.object({
  content: z.string().min(1),
  memoryType: z.nativeEnum(MemoryType),
  containerTag: z.string().min(1),
  sourceDocId: z.string().uuid(),
  confidence: z.number().min(0).max(1).default(0.9),
  validFrom: z.string().datetime().optional(),
  validTo: z.string().datetime().optional()
});

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

const ingestDocumentArgsSchema = z.object({
  content: z.string().min(1),
  contentType: z.nativeEnum(ContentType),
  containerTag: z.string().min(1),
  title: z.string().min(1).optional(),
  metadata: z.record(z.unknown()).optional()
});

const ingestUrlArgsSchema = z.object({
  url: z.string().url(),
  containerTag: z.string().min(1),
  title: z.string().min(1).optional(),
  metadata: z.record(z.unknown()).optional()
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
  metadata: z.record(z.unknown()).optional()
});

const getDocumentStatusArgsSchema = z.object({
  documentId: z.string().uuid()
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

const getMemoryRelationsArgsSchema = z.object({
  memoryId: z.string().uuid()
});

const forgetMemoryArgsSchema = z.object({
  memoryId: z.string().uuid()
});

const getUserProfileArgsSchema = z.object({
  containerTag: z.string().min(1),
  regenerate: z.boolean().default(false),
  includeSearch: z.boolean().default(false)
});

const crawlUrlArgsSchema = z.object({
  url: z.string().url(),
  containerTag: z.string().min(1)
});

const crawlUrlsArgsSchema = z.object({
  urls: z.array(z.string().url()).min(1),
  containerTag: z.string().min(1)
});

const listCrawledUrlsArgsSchema = z.object({
  containerTag: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(500).default(100)
});

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

  /**
   * Creates the MCP server and internal services.
   */
  public constructor() {
    const config = loadConfig();
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
   * Starts the server on HTTP/SSE transport.
   * @param port Port to listen on (default 8080).
   * @param host Host to bind to (default 0.0.0.0).
   */
  public async startSSE(port = 8080, host = "0.0.0.0"): Promise<void> {
    await this.neo4jClient.verifyConnectivity();

    const sessions = new Map<string, SSEServerTransport>();

    const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

      // CORS headers
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      // Health check
      if (url.pathname === "/health" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", version: "0.2.0" }));
        return;
      }

      // SSE endpoint — client connects here to establish the stream
      if (url.pathname === "/sse" && req.method === "GET") {
        const transport = new SSEServerTransport("/messages", res);
        sessions.set(transport.sessionId, transport);

        transport.onclose = () => {
          sessions.delete(transport.sessionId);
        };

        // Each SSE connection gets its own Server instance to handle the session
        const sessionServer = new Server(
          { name: "supermemento-mcp", version: "0.2.0" },
          { capabilities: { tools: {} } }
        );
        this.registerHandlersOnServer(sessionServer);
        await sessionServer.connect(transport);
        return;
      }

      // Message endpoint — client POSTs JSON-RPC messages here
      if (url.pathname === "/messages" && req.method === "POST") {
        const sessionId = url.searchParams.get("sessionId");
        if (!sessionId || !sessions.has(sessionId)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid or missing sessionId" }));
          return;
        }
        const transport = sessions.get(sessionId)!;
        await transport.handlePostMessage(req, res);
        return;
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    });

    httpServer.listen(port, host, () => {
      console.log(`[supermemento] SSE server listening on http://${host}:${port}`);
      console.log(`[supermemento] SSE endpoint: GET /sse`);
      console.log(`[supermemento] Message endpoint: POST /messages`);
      console.log(`[supermemento] Health: GET /health`);
    });
  }

  /**
   * Closes all external resources.
   */
  public async close(): Promise<void> {
    await this.neo4jClient.close();
  }

  private registerHandlersOnServer(targetServer: Server): void {
    targetServer.setRequestHandler(ListToolsRequestSchema, async (): Promise<ListToolsResult> => ({
      tools: [
        {
          name: "create_memory",
          description:
            "Create a Memory node, generate embedding, and run intelligent relation classification",
          inputSchema: zodToJsonSchema(createMemoryArgsSchema)
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
          description: "Ingest a document through full extraction/chunking/memory/index pipeline",
          inputSchema: zodToJsonSchema(ingestDocumentArgsSchema)
        },
        {
          name: "ingest_url",
          description: "Fetch URL content and run the full ingestion pipeline",
          inputSchema: zodToJsonSchema(ingestUrlArgsSchema)
        },
        {
          name: "ingest_conversation",
          description: "Ingest conversation messages and run full pipeline",
          inputSchema: zodToJsonSchema(ingestConversationArgsSchema)
        },
        {
          name: "get_document_status",
          description: "Get the processing status for a document",
          inputSchema: zodToJsonSchema(getDocumentStatusArgsSchema)
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
          name: "get_memory_relations",
          description: "Get all relations connected to a memory",
          inputSchema: zodToJsonSchema(getMemoryRelationsArgsSchema)
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
          name: "get_user_profile",
          description: "Get or regenerate static+dynamic user profile",
          inputSchema: zodToJsonSchema(getUserProfileArgsSchema)
        },
        {
          name: "crawl_url",
          description: "One-shot crawl of a URL and ingest if changed",
          inputSchema: zodToJsonSchema(crawlUrlArgsSchema)
        },
        {
          name: "crawl_urls",
          description: "Batch crawl multiple URLs and ingest changed content",
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
      try {
        const name = request.params.name;
        const args = request.params.arguments ?? {};

        switch (name) {
          case "create_memory": {
            const input = createMemoryArgsSchema.parse(args);
            const embedding = await this.embeddingService.generateEmbedding(input.content);
            const memory = await this.neo4jClient.createMemory({
              content: input.content,
              memoryType: input.memoryType,
              containerTag: input.containerTag,
              confidence: input.confidence,
              sourceDocId: input.sourceDocId,
              embedding,
              validFrom: input.validFrom,
              validTo: input.validTo
            });
            const relationResult = await this.relationClassifierService.classifyAndApply(memory);
            return asJson({ memory, relationResult });
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
            const result = await this.ingestionPipeline.ingest({
              title: input.title ?? `Ingested ${input.contentType}`,
              contentType: input.contentType,
              rawContent: input.content,
              containerTag: input.containerTag,
              metadata: input.metadata
            });
            return asJson(result);
          }

          case "ingest_url": {
            const input = ingestUrlArgsSchema.parse(args);
            const result = await this.ingestionPipeline.ingest({
              title: input.title ?? input.url,
              contentType: ContentType.Url,
              rawContent: input.url,
              containerTag: input.containerTag,
              sourceUrl: input.url,
              metadata: input.metadata
            });
            return asJson(result);
          }

          case "ingest_conversation": {
            const input = ingestConversationArgsSchema.parse(args);
            const result = await this.ingestionPipeline.ingest({
              title: input.title ?? "Conversation Ingestion",
              contentType: ContentType.Conversation,
              rawContent: JSON.stringify(input.messages),
              containerTag: input.containerTag,
              metadata: input.metadata
            });
            return asJson(result);
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

          case "list_documents": {
            const input = listDocumentsArgsSchema.parse(args);
            const documents = await this.neo4jClient.listDocuments(input);
            return asJson({ count: documents.length, documents });
          }

          case "list_memories": {
            const input = listMemoriesArgsSchema.parse(args);
            const memories = await this.neo4jClient.listMemories(input);
            return asJson({ count: memories.length, memories });
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
              input.containerTag
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
              input.containerTag
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
        const message = error instanceof Error ? error.message : "Unknown error";
        return asError(message);
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
    required,
    additionalProperties: false
  };
}

function mapZodType(
  type: z.ZodTypeAny
): { schema: Record<string, unknown>; required: boolean } {
  const optional = type instanceof z.ZodOptional || type instanceof z.ZodDefault;
  const target = type instanceof z.ZodOptional || type instanceof z.ZodDefault ? type._def.innerType : type;

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
