import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
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
import { RelationClassifierService } from "./services/relation-classifier.js";
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
  minSimilarity: z.number().min(0).max(1).default(0.6),
  limit: z.number().int().min(1).max(100).default(10)
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

/** Supermemento MCP server implementation. */
export class SupermementoServer {
  private readonly server: Server;
  private readonly neo4jClient: Neo4jClient;
  private readonly embeddingService: EmbeddingService;
  private readonly relationClassifierService: RelationClassifierService;

  /**
   * Creates the MCP server and internal services.
   */
  public constructor() {
    const config = loadConfig();
    this.neo4jClient = new Neo4jClient(config);
    this.embeddingService = new EmbeddingService(config);
    this.relationClassifierService = new RelationClassifierService(
      config,
      this.neo4jClient,
      this.embeddingService
    );

    this.server = new Server(
      {
        name: "supermemento-mcp",
        version: "0.1.0"
      },
      {
        capabilities: {
          tools: {}
        }
      }
    );

    this.registerHandlers();
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
   * Closes all external resources.
   */
  public async close(): Promise<void> {
    await this.neo4jClient.close();
  }

  private registerHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async (): Promise<ListToolsResult> => ({
      tools: [
        {
          name: "create_memory",
          description:
            "Create a Memory node, generate embedding, and run Phase 1 intelligent relation classification",
          inputSchema: zodToJsonSchema(createMemoryArgsSchema)
        },
        {
          name: "semantic_search",
          description: "Search memories by vector similarity with optional containerTag filter",
          inputSchema: zodToJsonSchema(semanticSearchArgsSchema)
        },
        {
          name: "create_document",
          description: "Create a Document node with queued status",
          inputSchema: zodToJsonSchema(createDocumentArgsSchema)
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

    this.server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
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
            const queryEmbedding = await this.embeddingService.generateEmbedding(input.query);
            const hits = await this.neo4jClient.semanticSearchMemories({
              embedding: queryEmbedding,
              containerTag: input.containerTag,
              minScore: input.minSimilarity,
              limit: input.limit,
              isLatestOnly: true
            });
            return asJson({ query: input.query, results: hits });
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

          case "get_document_status": {
            const input = getDocumentStatusArgsSchema.parse(args);
            const document = await this.neo4jClient.getDocument(input.documentId);
            if (!document) {
              return asError(`Document not found: ${input.documentId}`);
            }
            return asJson({ documentId: document.id, status: document.status, updatedAt: document.updatedAt });
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
function zodToJsonSchema(schema: z.AnyZodObject): Record<string, unknown> {
  const shape = schema.shape;
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [key, value] of Object.entries(shape)) {
    const definition = mapZodType(value as z.ZodTypeAny);
    properties[key] = definition.schema;
    if (definition.required) {
      required.push(key);
    }
  }

  return {
    type: "object",
    properties,
    required,
    additionalProperties: false
  };
}

function mapZodType(type: z.ZodTypeAny): { schema: Record<string, unknown>; required: boolean } {
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

  if (target instanceof z.ZodEnum || target instanceof z.ZodNativeEnum) {
    const values =
      target instanceof z.ZodEnum ? [...target.options] : Object.values(target.enum).filter((v) => typeof v === "string");
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
