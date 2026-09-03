import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { z } from "zod";

function rawUrlHost(value: string): string | undefined {
  const schemeEnd = value.indexOf("://");
  if (schemeEnd < 0) return undefined;
  const remainder = value.slice(schemeEnd + 3);
  const authorityEnd = remainder.search(/[/?#]/);
  const authority = authorityEnd < 0 ? remainder : remainder.slice(0, authorityEnd);
  const hostAndPort = authority.slice(authority.lastIndexOf("@") + 1);
  if (!hostAndPort) return undefined;
  if (hostAndPort.startsWith("[")) {
    const bracketEnd = hostAndPort.indexOf("]");
    if (bracketEnd < 0) return undefined;
    const suffix = hostAndPort.slice(bracketEnd + 1);
    if (suffix && !suffix.startsWith(":")) return undefined;
    return hostAndPort.slice(0, bracketEnd + 1);
  }
  const portSeparator = hostAndPort.lastIndexOf(":");
  return (portSeparator < 0 ? hostAndPort : hostAndPort.slice(0, portSeparator)) || undefined;
}

function isPrivateRelayUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return false;
    }
    const host = rawUrlHost(value)?.toLowerCase();
    if (!host || url.hostname.toLowerCase() !== host) {
      return false;
    }
    if (host === "localhost" || host === "[::1]") {
      return true;
    }
    if (host === "codex-oauth-bridge") {
      return true;
    }
    const labels = host.split(".");
    if (labels.length !== 4 || labels.some((part) => !/^(0|[1-9]\d{0,2})$/.test(part))) {
      return false;
    }
    const octets = labels.map(Number);
    if (octets.some((part) => part > 255)) {
      return false;
    }
    const [first, second] = octets as [number, number, number, number];
    return first === 10
      || first === 127
      || (first === 172 && second >= 16 && second <= 31)
      || (first === 192 && second === 168)
      || (first === 100 && second >= 64 && second <= 127);
  } catch {
    return false;
  }
}

function resolveCodexRelayKey(): string | undefined {
  const direct = process.env.OPENAI_CODEX_RELAY_KEY?.trim();
  if (direct) {
    return direct;
  }
  const secretPath = process.env.OPENAI_CODEX_RELAY_KEY_FILE?.trim();
  if (!secretPath) {
    return undefined;
  }
  try {
    return readFileSync(secretPath, "utf8").trim() || undefined;
  } catch {
    throw new Error("OPENAI_CODEX_RELAY_KEY_FILE could not be read");
  }
}

const envSchema = z
  .object({
    NEO4J_URI: z.string().min(1),
    NEO4J_USER: z.string().min(1),
    NEO4J_PASSWORD: z.string().min(1),
    OPENAI_API_KEY: z.string().min(1),
    OPENAI_EMBEDDING_MODEL: z.string().min(1).default("text-embedding-3-large"),
    LLM_PROVIDER: z
      .enum(["anthropic", "openai-codex", "openai-codex-subscription"])
      .default("anthropic"),
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    ANTHROPIC_MODEL: z.string().min(1).default("claude-haiku-4-5-20251001"),
    OPENAI_CODEX_MODEL: z.string().min(1).default("gpt-5.6-luna"),
    OPENAI_CODEX_BASE_URL: z.string().url().optional(),
    OPENAI_CODEX_RELAY_KEY: z.string().min(32).optional(),
    CODEX_HOME: z.string().min(1).default("/data/supermemento-codex"),
    OPENAI_CODEX_WORKDIR: z.string().min(1).default("/app"),
    LLM_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300000).default(180000),
    LLM_REASONING_EFFORT: z.enum(["low", "medium", "high"]).default("low"),
    COHERE_API_KEY: z.string().min(1).optional(),
    COHERE_RERANK_MODEL: z.string().min(1).default("rerank-v3.5")
  })
  .superRefine((config, context) => {
    if (config.LLM_PROVIDER === "anthropic" && !config.ANTHROPIC_API_KEY) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ANTHROPIC_API_KEY"],
        message: "ANTHROPIC_API_KEY is required when LLM_PROVIDER=anthropic"
      });
    }
    if (config.LLM_PROVIDER === "openai-codex") {
      if (!config.OPENAI_CODEX_BASE_URL) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["OPENAI_CODEX_BASE_URL"],
          message: "OPENAI_CODEX_BASE_URL is required when LLM_PROVIDER=openai-codex"
        });
      } else if (!isPrivateRelayUrl(config.OPENAI_CODEX_BASE_URL)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["OPENAI_CODEX_BASE_URL"],
          message: "OPENAI_CODEX_BASE_URL must target the internal bridge or a private/loopback address"
        });
      } else if (new URL(config.OPENAI_CODEX_BASE_URL).pathname.replace(/\/$/, "") !== "/v1") {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["OPENAI_CODEX_BASE_URL"],
          message: "OPENAI_CODEX_BASE_URL must end in /v1"
        });
      }
      if (!config.OPENAI_CODEX_RELAY_KEY) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["OPENAI_CODEX_RELAY_KEY"],
          message: "OPENAI_CODEX_RELAY_KEY is required when LLM_PROVIDER=openai-codex"
        });
      }
    }
    if (config.LLM_PROVIDER === "openai-codex-subscription") {
      if (!isAbsolute(config.CODEX_HOME)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["CODEX_HOME"],
          message: "CODEX_HOME must be an absolute dedicated path when LLM_PROVIDER=openai-codex-subscription"
        });
      }
      if (!isAbsolute(config.OPENAI_CODEX_WORKDIR)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["OPENAI_CODEX_WORKDIR"],
          message: "OPENAI_CODEX_WORKDIR must be absolute when LLM_PROVIDER=openai-codex-subscription"
        });
      }
    }
  });

/** Runtime application configuration loaded from environment variables. */
export type AppConfig = z.infer<typeof envSchema>;

/**
 * Parses and validates environment variables.
 * @returns Strongly typed application configuration.
 */
export function loadConfig(): AppConfig {
  const provider = process.env.LLM_PROVIDER;
  const parsed = envSchema.safeParse({
    NEO4J_URI: process.env.NEO4J_URI,
    NEO4J_USER: process.env.NEO4J_USER,
    NEO4J_PASSWORD: process.env.NEO4J_PASSWORD,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_EMBEDDING_MODEL: process.env.OPENAI_EMBEDDING_MODEL,
    LLM_PROVIDER: process.env.LLM_PROVIDER,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL,
    OPENAI_CODEX_MODEL: process.env.OPENAI_CODEX_MODEL,
    OPENAI_CODEX_BASE_URL: process.env.OPENAI_CODEX_BASE_URL?.trim() || undefined,
    OPENAI_CODEX_RELAY_KEY: provider === "openai-codex"
      ? resolveCodexRelayKey()
      : process.env.OPENAI_CODEX_RELAY_KEY?.trim() || undefined,
    CODEX_HOME: process.env.CODEX_HOME?.trim() || undefined,
    OPENAI_CODEX_WORKDIR: process.env.OPENAI_CODEX_WORKDIR?.trim() || undefined,
    LLM_REQUEST_TIMEOUT_MS: process.env.LLM_REQUEST_TIMEOUT_MS,
    LLM_REASONING_EFFORT: process.env.LLM_REASONING_EFFORT,
    COHERE_API_KEY: process.env.COHERE_API_KEY,
    COHERE_RERANK_MODEL: process.env.COHERE_RERANK_MODEL
  });

  if (!parsed.success) {
    throw new Error(`Invalid environment configuration: ${parsed.error.message}`);
  }

  return parsed.data;
}
