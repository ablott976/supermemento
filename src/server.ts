import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult, type ListToolsResult } from "@modelcontextprotocol/sdk/types.js";
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
  confidence: z.number().min(0
