import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult, type ListToolsResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
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
  sourceDocId: z.string().uuid().optional(),
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
  content: z.string().min(1).optional(),
  memoryType: z.nativeEnum(MemoryType).optional(),
  isLatest: z.boolean().optional(),
  confidence: z.number().min(0).max(1).optional()
});

async function main() {
  const config = await loadConfig();
  const neo4jClient = new Neo4jClient(config.neo4j);
  await neo4jClient.connect();
  await setupSchema(neo4jClient);

  const embeddingService = new EmbeddingService(config.embeddings);
  const forgettingService = new ForgettingService(neo4jClient);
  const memoryExtractor = new MemoryExtractorService(embeddingService);
  const ingestionPipeline = new IngestionPipeline(
    neo4jClient,
    embeddingService,
    memoryExtractor
  );
  const profileService = new ProfileService(neo4jClient, embeddingService);
  const relationClassifier = new RelationClassifierService(neo4jClient, embeddingService);
  const searchService = new SearchService(neo4jClient, embeddingService);
  const webCrawler = new WebCrawlerConnector();

  const server = new Server(
    {
      name: "memory-server",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async (): Promise<ListToolsResult> => {
    return {
      tools: [
        {
          name: "create_memory",
          description: "Create a new memory entry with optional temporal bounds and confidence score",
          inputSchema: zodToJsonSchema(createMemoryArgsSchema) as any,
        },
        {
          name: "semantic_search",
          description: "Search memories and documents using semantic similarity with optional reranking and query rewriting",
          inputSchema: zodToJsonSchema(semanticSearchArgsSchema) as any,
        },
        {
          name: "create_document",
          description: "Create a new document entry",
          inputSchema: zodToJsonSchema(createDocumentArgsSchema) as any,
        },
        {
          name: "ingest_document",
          description: "Ingest raw content and process it through the pipeline",
          inputSchema: zodToJsonSchema(ingestDocumentArgsSchema) as any,
        },
        {
          name: "ingest_url",
          description: "Crawl a URL and ingest its content",
          inputSchema: zodToJsonSchema(ingestUrlArgsSchema) as any,
        },
        {
          name: "ingest_conversation",
          description: "Ingest a conversation transcript",
          inputSchema: zodToJsonSchema(ingestConversationArgsSchema) as any,
        },
        {
          name: "get_document_status",
          description: "Get the processing status of a document",
          inputSchema: zodToJsonSchema(getDocumentStatusArgsSchema) as any,
        },
        {
          name: "delete_document",
          description: "Delete a document and its associated memories",
          inputSchema: zodToJsonSchema(deleteDocumentArgsSchema) as any,
        },
        {
          name: "update_document",
          description: "Update document metadata, content, or status",
          inputSchema: zodToJsonSchema(updateDocumentArgsSchema) as any,
        },
        {
          name: "list_documents",
          description: "List documents with optional filtering by container tag and status. Returns documents with metadata including processing status.",
          inputSchema: zodToJsonSchema(listDocumentsArgsSchema) as any,
        },
        {
          name: "list_memories",
          description: "List memories with optional filtering by container tag, memory type, and latest status. Returns memories with content, metadata, and relationships.",
          inputSchema: zodToJsonSchema(listMemoriesArgsSchema) as any,
        },
        {
          name: "delete_memory",
          description: "Delete a specific memory by ID",
          inputSchema: zodToJsonSchema(deleteMemoryArgsSchema) as any,
        },
        {
          name: "update_memory",
          description: "Update memory content, type, or metadata",
          inputSchema: zodToJsonSchema(updateMemoryArgsSchema) as any,
        },
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    try {
      const { name, arguments: args } = request.params;

      switch (name) {
        case "create_memory": {
          const parsed = createMemoryArgsSchema.parse(args);
          const memory = await neo4jClient.createMemory(parsed);
          return {
            content: [{ type: "text", text: JSON.stringify(memory, null, 2) }],
          };
        }

        case "semantic_search": {
          const parsed = semanticSearchArgsSchema.parse(args);
          const results = await searchService.semanticSearch(parsed);
          return {
            content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
          };
        }

        case "create_document": {
          const parsed = createDocumentArgsSchema.parse(args);
          const doc = await neo4jClient.createDocument(parsed);
          return {
            content: [{ type: "text", text: JSON.stringify(doc, null, 2) }],
          };
        }

        case "ingest_document": {
          const parsed = ingestDocumentArgsSchema.parse(args);
          const result = await ingestionPipeline.ingestText(parsed);
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }

        case "ingest_url": {
          const parsed = ingestUrlArgsSchema.parse(args);
          const crawled = await webCrawler.crawl(parsed.url);
          const result = await ingestionPipeline.ingestText({
            content: crawled.content,
            contentType: ContentType.TEXT,
            containerTag: parsed.containerTag,
            title: parsed.title || crawled.title,
            metadata: { ...parsed.metadata, sourceUrl: parsed.url },
          });
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }

        case "ingest_conversation": {
          const parsed = ingestConversationArgsSchema.parse(args);
          const result = await ingestionPipeline.ingestConversation(parsed);
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }

        case "get_document_status": {
          const parsed = getDocumentStatusArgsSchema.parse(args);
          const status = await neo4jClient.getDocumentStatus(parsed.documentId);
          return {
            content: [{ type: "text", text: JSON.stringify(status, null, 2) }],
          };
        }

        case "delete_document": {
          const parsed = deleteDocumentArgsSchema.parse(args);
          await neo4jClient.deleteDocument(parsed.documentId);
          return {
            content: [{ type: "text", text: JSON.stringify({ success: true, message: "Document deleted successfully" }, null, 2) }],
          };
        }

        case "update_document": {
          const parsed = updateDocumentArgsSchema.parse(args);
          const updated = await neo4jClient.updateDocument(parsed);
          return {
            content: [{ type: "text", text: JSON.stringify(updated, null, 2) }],
          };
        }

        case "list_documents": {
          const parsed = listDocumentsArgsSchema.parse(args);
          const documents = await searchService.listDocuments({
            containerTag: parsed.containerTag,
            status: parsed.status,
            limit: parsed.limit,
          });
          
          // Format response with clear structure and metadata
          const response = {
            count: documents.length,
            documents: documents.map(doc => ({
              id: doc.id,
              title: doc.title,
              contentType: doc.contentType,
              status: doc.status,
              containerTag: doc.containerTag,
              createdAt: doc.createdAt,
              updatedAt: doc.updatedAt,
              metadata: doc.metadata,
              sourceUrl: doc.sourceUrl,
              filePath: doc.filePath,
            })),
          };
          
          return {
            content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
          };
        }

        case "list_memories": {
          const parsed = listMemoriesArgsSchema.parse(args);
          const memories = await searchService.listMemories({
            containerTag: parsed.containerTag,
            memoryType: parsed.memoryType,
            isLatest: parsed.isLatest,
            limit: parsed.limit,
          });
          
          // Format response with clear structure including relationships and metadata
          const response = {
            count: memories.length,
            memories: memories.map(memory => ({
              id: memory.id,
              content: memory.content,
              memoryType: memory.memoryType,
              containerTag: memory.containerTag,
              confidence: memory.confidence,
              isLatest: memory.isLatest,
              validFrom: memory.validFrom,
              validTo: memory.validTo,
              createdAt: memory.createdAt,
              updatedAt: memory.updatedAt,
              sourceDocId: memory.sourceDocId,
              relationships: memory.relationships || [],
              metadata: memory.metadata,
            })),
          };
          
          return {
            content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
          };
        }

        case "delete_memory": {
          const parsed = deleteMemoryArgsSchema.parse(args);
          await neo4jClient.deleteMemory(parsed.memoryId);
          return {
            content: [{ type: "text", text: JSON.stringify({ success: true, message: "Memory deleted successfully" }, null, 2) }],
          };
        }

        case "update_memory": {
          const parsed = updateMemoryArgsSchema.parse(args);
          const updated = await neo4jClient.updateMemory(parsed);
          return {
            content: [{ type: "text", text: JSON.stringify(updated, null, 2) }],
          };
        }

        default:
          return {
            content: [{ type: "text", text: `Unknown tool: ${name}` }],
            isError: true,
          };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Error: ${errorMessage}` }],
        isError: true,
      };
    }
  });

  // Determine transport type from environment or default to stdio
  const transportType = process.env.MCP_TRANSPORT || "stdio";

  if (transportType === "sse") {
    const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      if (req.url === "/sse") {
        const transport = new SSEServerTransport("/messages", res);
        await server.connect(transport);
      } else if (req.url === "/messages" && req.method === "POST") {
        // Messages endpoint handled by SSE transport
        res.statusCode = 200;
        res.end();
      } else {
        res.statusCode = 404;
        res.end();
      }
    });

    const port = parseInt(process.env.PORT || "3000", 10);
    httpServer.listen(port, () => {
      console.error(`Memory MCP Server running on port ${port}`);
    });
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Memory MCP Server running on stdio");
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
