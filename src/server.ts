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
          description: "Create a new memory entry",
          inputSchema: zodToJsonSchema(createMemoryArgsSchema) as any,
        },
        {
          name: "semantic_search",
          description: "Search memories using semantic similarity",
          inputSchema: zodToJsonSchema(semanticSearchArgsSchema) as any,
        },
        {
          name: "create_document",
          description: "Create a new document entry",
          inputSchema: zodToJsonSchema(createDocumentArgsSchema) as any,
        },
        {
          name: "ingest_document",
          description: "Ingest raw document content",
          inputSchema: zodToJsonSchema(ingestDocumentArgsSchema) as any,
        },
        {
          name: "ingest_url",
          description: "Ingest content from a URL",
          inputSchema: zodToJsonSchema(ingestUrlArgsSchema) as any,
        },
        {
          name: "ingest_conversation",
          description: "Ingest conversation messages",
          inputSchema: zodToJsonSchema(ingestConversationArgsSchema) as any,
        },
        {
          name: "get_document_status",
          description: "Get processing status of a document",
          inputSchema: zodToJsonSchema(getDocumentStatusArgsSchema) as any,
        },
        {
          name: "delete_document",
          description: "Delete a document and its associated memories",
          inputSchema: zodToJsonSchema(deleteDocumentArgsSchema) as any,
        },
        {
          name: "update_document",
          description: "Update document metadata or content",
          inputSchema: zodToJsonSchema(updateDocumentArgsSchema) as any,
        },
        {
          name: "list_documents",
          description: "List documents with optional filtering and response time tracking",
          inputSchema: zodToJsonSchema(listDocumentsArgsSchema) as any,
        },
        {
          name: "list_memories",
          description: "List memories with optional filtering and response time tracking",
          inputSchema: zodToJsonSchema(listMemoriesArgsSchema) as any,
        },
        {
          name: "delete_memory",
          description: "Delete a specific memory",
          inputSchema: zodToJsonSchema(deleteMemoryArgsSchema) as any,
        },
        {
          name: "update_memory",
          description: "Update a memory entry",
          inputSchema: zodToJsonSchema(updateMemoryArgsSchema) as any,
        },
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const startTime = Date.now();
    
    try {
      let result: { content: Array<{ type: string; text: string }>; metadata?: Record<string, unknown> };

      switch (request.params.name) {
        case "create_memory": {
          const args = createMemoryArgsSchema.parse(request.params.arguments);
          const memory = await neo4jClient.createMemory(args);
          result = {
            content: [{ type: "text", text: JSON.stringify(memory, null, 2) }],
          };
          break;
        }

        case "semantic_search": {
          const args = semanticSearchArgsSchema.parse(request.params.arguments);
          const results = await searchService.semanticSearch(args);
          result = {
            content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
          };
          break;
        }

        case "create_document": {
          const args = createDocumentArgsSchema.parse(request.params.arguments);
          const doc = await neo4jClient.createDocument(args);
          result = {
            content: [{ type: "text", text: JSON.stringify(doc, null, 2) }],
          };
          break;
        }

        case "ingest_document": {
          const args = ingestDocumentArgsSchema.parse(request.params.arguments);
          const doc = await ingestionPipeline.ingestDocument(args);
          result = {
            content: [{ type: "text", text: JSON.stringify(doc, null, 2) }],
          };
          break;
        }

        case "ingest_url": {
          const args = ingestUrlArgsSchema.parse(request.params.arguments);
          const content = await webCrawler.crawl(args.url);
          const doc = await ingestionPipeline.ingestDocument({
            ...args,
            content,
            contentType: ContentType.TEXT,
            title: args.title || args.url,
          });
          result = {
            content: [{ type: "text", text: JSON.stringify(doc, null, 2) }],
          };
          break;
        }

        case "ingest_conversation": {
          const args = ingestConversationArgsSchema.parse(request.params.arguments);
          const doc = await ingestionPipeline.ingestConversation(args);
          result = {
            content: [{ type: "text", text: JSON.stringify(doc, null, 2) }],
          };
          break;
        }

        case "get_document_status": {
          const args = getDocumentStatusArgsSchema.parse(request.params.arguments);
          const status = await neo4jClient.getDocumentStatus(args.documentId);
          result = {
            content: [{ type: "text", text: JSON.stringify(status, null, 2) }],
          };
          break;
        }

        case "delete_document": {
          const args = deleteDocumentArgsSchema.parse(request.params.arguments);
          await neo4jClient.deleteDocument(args.documentId);
          result = {
            content: [{ type: "text", text: JSON.stringify({ success: true, message: "Document deleted" }, null, 2) }],
          };
          break;
        }

        case "update_document": {
          const args = updateDocumentArgsSchema.parse(request.params.arguments);
          const doc = await neo4jClient.updateDocument(args.documentId, args);
          result = {
            content: [{ type: "text", text: JSON.stringify(doc, null, 2) }],
          };
          break;
        }

        case "list_documents": {
          const args = listDocumentsArgsSchema.parse(request.params.arguments);
          const queryStartTime = Date.now();
          
          const documents = await neo4jClient.listDocuments({
            containerTag: args.containerTag,
            status: args.status,
            limit: args.limit,
          });
          
          const queryTimeMs = Date.now() - queryStartTime;
          
          result = {
            content: [{ 
              type: "text", 
              text: JSON.stringify({
                documents,
                metadata: {
                  count: documents.length,
                  limit: args.limit,
                  containerTag: args.containerTag,
                  status: args.status,
                  queryTimeMs,
                  timestamp: new Date().toISOString(),
                }
              }, null, 2) 
            }],
            metadata: {
              queryTimeMs,
              totalTimeMs: Date.now() - startTime,
            }
          };
          break;
        }

        case "list_memories": {
          const args = listMemoriesArgsSchema.parse(request.params.arguments);
          const queryStartTime = Date.now();
          
          const memories = await neo4jClient.listMemories({
            containerTag: args.containerTag,
            memoryType: args.memoryType,
            isLatest: args.isLatest,
            limit: args.limit,
          });
          
          const queryTimeMs = Date.now() - queryStartTime;
          
          result = {
            content: [{ 
              type: "text", 
              text: JSON.stringify({
                memories,
                metadata: {
                  count: memories.length,
                  limit: args.limit,
                  containerTag: args.containerTag,
                  memoryType: args.memoryType,
                  isLatest: args.isLatest,
                  queryTimeMs,
                  timestamp: new Date().toISOString(),
                }
              }, null, 2) 
            }],
            metadata: {
              queryTimeMs,
              totalTimeMs: Date.now() -
