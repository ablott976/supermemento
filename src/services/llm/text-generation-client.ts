import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

import type { AppConfig } from "../../config.js";

export interface TextGenerationRequest {
  operation: string;
  system: string;
  user: string;
  maxTokens: number;
}

export interface TextGenerationClient {
  readonly provider: "anthropic" | "openai-codex";
  complete(request: TextGenerationRequest): Promise<string>;
}

type AnthropicLike = {
  messages: {
    create(request: Record<string, unknown>): Promise<{
      content: Array<{ type: string; text?: string }>;
    }>;
  };
};

type OpenAiResponsesLike = {
  responses: {
    create(request: Record<string, unknown>): Promise<AsyncIterable<Record<string, unknown>>>;
  };
};

function statusFromError(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : undefined;
}

function providerError(provider: string, phase: string, error: unknown): Error {
  const status = statusFromError(error);
  const wrapped = new Error(
    `${provider} ${phase} failed${status === undefined ? "" : ` (HTTP ${status})`}`
  );
  if (status !== undefined) {
    Object.assign(wrapped, { status });
  }
  return wrapped;
}

function requireNonEmpty(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${name} is required when LLM_PROVIDER=openai-codex`);
  }
  return normalized;
}

export class ObservedTextGenerationClient implements TextGenerationClient {
  public readonly provider: TextGenerationClient["provider"];

  public constructor(
    private readonly delegate: TextGenerationClient,
    private readonly model: string
  ) {
    this.provider = delegate.provider;
  }

  public async complete(request: TextGenerationRequest): Promise<string> {
    const startedAt = Date.now();
    try {
      const result = await this.delegate.complete(request);
      console.info(
        `[llm] provider=${this.provider} model=${this.model} operation=${request.operation} outcome=success duration_ms=${Date.now() - startedAt}`
      );
      return result;
    } catch (error) {
      const status = statusFromError(error);
      console.info(
        `[llm] provider=${this.provider} model=${this.model} operation=${request.operation} outcome=error duration_ms=${Date.now() - startedAt}${status === undefined ? "" : ` http_status=${status}`}`
      );
      throw error;
    }
  }
}

export class AnthropicTextGenerationClient implements TextGenerationClient {
  public readonly provider = "anthropic" as const;
  private readonly model: string;
  private readonly client: AnthropicLike;

  public constructor(config: AppConfig, client?: AnthropicLike) {
    const apiKey = config.ANTHROPIC_API_KEY?.trim();
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY is required when LLM_PROVIDER=anthropic");
    }
    this.model = config.ANTHROPIC_MODEL;
    this.client = client ?? (new Anthropic({ apiKey }) as unknown as AnthropicLike);
  }

  public async complete(request: TextGenerationRequest): Promise<string> {
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: request.maxTokens,
        system: request.system,
        messages: [{ role: "user", content: request.user }]
      });
      const text = response.content
        .filter((block) => block.type === "text" && typeof block.text === "string")
        .map((block) => block.text ?? "")
        .join("\n")
        .trim();
      if (!text) {
        throw new Error("Anthropic returned no text");
      }
      return text;
    } catch (error) {
      if (error instanceof Error && error.message === "Anthropic returned no text") {
        throw error;
      }
      throw providerError("anthropic", "request", error);
    }
  }
}

export class OpenAiCodexTextGenerationClient implements TextGenerationClient {
  public readonly provider = "openai-codex" as const;
  private readonly model: string;
  private readonly reasoningEffort: AppConfig["LLM_REASONING_EFFORT"];
  private readonly client: OpenAiResponsesLike;

  public constructor(config: AppConfig, client?: OpenAiResponsesLike) {
    const baseURL = requireNonEmpty(config.OPENAI_CODEX_BASE_URL, "OPENAI_CODEX_BASE_URL");
    const apiKey = requireNonEmpty(config.OPENAI_CODEX_RELAY_KEY, "OPENAI_CODEX_RELAY_KEY");
    this.model = config.OPENAI_CODEX_MODEL;
    this.reasoningEffort = config.LLM_REASONING_EFFORT;
    this.client = client ?? (new OpenAI({
      apiKey,
      baseURL: baseURL.replace(/\/$/, ""),
      timeout: config.LLM_REQUEST_TIMEOUT_MS,
      maxRetries: 0
    }) as unknown as OpenAiResponsesLike);
  }

  public async complete(request: TextGenerationRequest): Promise<string> {
    const maxCharacters = Math.max(1024, request.maxTokens * 8);
    let stream: AsyncIterable<Record<string, unknown>>;
    try {
      stream = await this.client.responses.create({
        model: this.model,
        instructions: request.system,
        input: [
          {
            role: "user",
            content: [{ type: "input_text", text: request.user }]
          }
        ],
        store: false,
        stream: true,
        reasoning: { effort: this.reasoningEffort, summary: "auto" }
      });
    } catch (error) {
      throw providerError("openai-codex", "request", error);
    }

    let text = "";
    let completedText = "";
    try {
      for await (const event of stream) {
        const type = event.type;
        if (type === "response.output_text.delta" && typeof event.delta === "string") {
          text += event.delta;
        } else if (type === "response.output_text.done" && typeof event.text === "string") {
          completedText = event.text;
        } else if (type === "response.failed") {
          throw new Error("Codex response failed");
        }
        if (text.length > maxCharacters || completedText.length > maxCharacters) {
          throw new Error("Codex response exceeded the configured output limit");
        }
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Codex response")) {
        throw error;
      }
      throw providerError("openai-codex", "stream", error);
    }

    const result = (text || completedText).trim();
    if (!result) {
      throw new Error("openai-codex returned no text");
    }
    return result;
  }
}

export function createTextGenerationClient(config: AppConfig): TextGenerationClient {
  if (config.LLM_PROVIDER === "openai-codex") {
    return new ObservedTextGenerationClient(
      new OpenAiCodexTextGenerationClient(config),
      config.OPENAI_CODEX_MODEL
    );
  }
  return new ObservedTextGenerationClient(
    new AnthropicTextGenerationClient(config),
    config.ANTHROPIC_MODEL
  );
}
