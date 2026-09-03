import Anthropic from "@anthropic-ai/sdk";
import { Codex } from "@openai/codex-sdk";
import { chmodSync, mkdirSync } from "node:fs";
import OpenAI from "openai";

import type { AppConfig } from "../../config.js";

export interface TextGenerationRequest {
  operation: string;
  system: string;
  user: string;
  maxTokens: number;
}

export interface TextGenerationClient {
  readonly provider: "anthropic" | "openai-codex" | "openai-codex-subscription";
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

type CodexSdkLike = {
  startThread(options: {
    model: string;
    modelReasoningEffort: AppConfig["LLM_REASONING_EFFORT"];
    sandboxMode: "read-only";
    workingDirectory: string;
    skipGitRepoCheck: true;
    networkAccessEnabled: false;
    webSearchMode: "disabled";
    approvalPolicy: "never";
  }): {
    run(input: string, options: { signal: AbortSignal }): Promise<{ finalResponse: string }>;
  };
};

const CODEX_MAX_ATTEMPTS = 2;
const CODEX_RETRY_DELAY_MS = 1_000;

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
  const failureType = failureTypeFromError(error);
  if (failureType) {
    Object.assign(wrapped, { failureType });
  }
  return wrapped;
}

function failureTypeFromError(
  error: unknown
): "auth" | "rate_limit" | "server" | "timeout" | undefined {
  const status = statusFromError(error);
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limit";
  if (status !== undefined && status >= 500) return "server";

  const candidate = error as { code?: unknown; name?: unknown; message?: unknown } | null;
  const code = typeof candidate?.code === "string" ? candidate.code.toLowerCase() : "";
  const name = typeof candidate?.name === "string" ? candidate.name.toLowerCase() : "";
  const message = typeof candidate?.message === "string" ? candidate.message.toLowerCase() : "";
  if (
    name === "aborterror" ||
    ["etimedout", "esockettimedout"].includes(code) ||
    /timed?\s*out|timeout/.test(message)
  ) {
    return "timeout";
  }
  if (/rate.?limit|usage limit|quota|too many requests|\b429\b/.test(message)) {
    return "rate_limit";
  }
  if (/unauthori[sz]ed|forbidden|auth(?:entication)? failed|not logged in|login required|\b40[13]\b/.test(message)) {
    return "auth";
  }
  if (/server error|service unavailable|bad gateway|gateway timeout|http 5\d\d|\b5\d\d\b/.test(message)) {
    return "server";
  }
  return undefined;
}

function isRetryableCodexError(error: unknown): boolean {
  const status = statusFromError(error);
  if (status !== undefined) {
    return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
  }
  if (!(error instanceof Error)) {
    return false;
  }
  if (
    error.message === "Codex response exceeded the configured output limit" ||
    error.message.includes("returned no text")
  ) {
    return false;
  }
  return (
    error.message.startsWith("openai-codex request failed") ||
    error.message.startsWith("openai-codex stream failed") ||
    error.message === "Codex response was incomplete" ||
    error.message === "Codex response failed" ||
    error.message === "Codex response ended without completion"
  );
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

  public constructor(
    config: AppConfig,
    client?: OpenAiResponsesLike,
    private readonly retryDelayMs = CODEX_RETRY_DELAY_MS
  ) {
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
    let lastError: unknown;
    for (let attempt = 1; attempt <= CODEX_MAX_ATTEMPTS; attempt += 1) {
      try {
        return await this.completeOnce(request);
      } catch (error) {
        lastError = error;
        if (attempt === CODEX_MAX_ATTEMPTS || !isRetryableCodexError(error)) {
          throw error;
        }
        console.info(
          `[llm] provider=${this.provider} model=${this.model} operation=${request.operation} retry=${attempt} reason=transient`
        );
        if (this.retryDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs));
        }
      }
    }
    throw lastError;
  }

  private async completeOnce(request: TextGenerationRequest): Promise<string> {
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
    let completed = false;
    try {
      for await (const event of stream) {
        const type = event.type;
        if (type === "response.output_text.delta" && typeof event.delta === "string") {
          text += event.delta;
        } else if (type === "response.output_text.done" && typeof event.text === "string") {
          completedText = event.text;
        } else if (type === "response.completed") {
          completed = true;
        } else if (type === "response.incomplete") {
          throw new Error("Codex response was incomplete");
        } else if (type === "response.failed") {
          throw new Error("Codex response failed");
        }
        if (text.length > maxCharacters || completedText.length > maxCharacters) {
          throw new Error("Codex response exceeded the configured output limit");
        }
      }
      if (!completed) {
        throw new Error("Codex response ended without completion");
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

const CODEX_SUBSCRIPTION_PROVIDER = "openai-codex-subscription" as const;

/** @internal Builds the minimal child-process environment for the Codex subscription runtime. */
export function buildCodexSubscriptionEnvironment(config: AppConfig): Record<string, string> {
  const allowedNames = [
    "PATH",
    "HOME",
    "LANG",
    "LC_ALL",
    "TERM",
    "TMPDIR",
    "SSL_CERT_FILE",
    "NODE_EXTRA_CA_CERTS",
    "CODEX_CA_CERTIFICATE",
    "CODEX_CI",
    "CODEX_EXEC_SERVER_REMOTE_BASE_URL",
    "CODEX_NETWORK_ALLOW_LOCAL_BINDING",
    "CODEX_NETWORK_PROXY_ACTIVE",
    "CODEX_PROXY_CERT",
    "CODEX_SANDBOX_NETWORK_DISABLED",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "no_proxy"
  ];
  const environment: Record<string, string> = { CODEX_HOME: config.CODEX_HOME };
  for (const name of allowedNames) {
    const value = process.env[name];
    if (value) environment[name] = value;
  }
  return environment;
}

function codexPrompt(request: TextGenerationRequest): string {
  return [
    "Complete this text-generation request without using tools or reading files.",
    `Keep the final answer within approximately ${request.maxTokens} tokens.`,
    "",
    "Instructions:",
    request.system,
    "",
    "Input:",
    request.user
  ].join("\n");
}

/** Text generation through the official Codex runtime and a ChatGPT subscription session. */
export class OpenAiCodexSubscriptionTextGenerationClient implements TextGenerationClient {
  public readonly provider = CODEX_SUBSCRIPTION_PROVIDER;
  private readonly model: string;
  private readonly reasoningEffort: AppConfig["LLM_REASONING_EFFORT"];
  private readonly timeoutMs: number;
  private readonly workingDirectory: string;
  private readonly client: CodexSdkLike;

  public constructor(config: AppConfig, client?: CodexSdkLike) {
    this.model = config.OPENAI_CODEX_MODEL;
    this.reasoningEffort = config.LLM_REASONING_EFFORT;
    this.timeoutMs = config.LLM_REQUEST_TIMEOUT_MS;
    this.workingDirectory = config.OPENAI_CODEX_WORKDIR;

    mkdirSync(config.CODEX_HOME, { recursive: true, mode: 0o700 });
    chmodSync(config.CODEX_HOME, 0o700);
    this.client = client ?? (new Codex({
      env: buildCodexSubscriptionEnvironment(config),
      config: {
        forced_login_method: "chatgpt",
        cli_auth_credentials_store: "file"
      }
    }) as CodexSdkLike);
  }

  public async complete(request: TextGenerationRequest): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const thread = this.client.startThread({
        model: this.model,
        modelReasoningEffort: this.reasoningEffort,
        sandboxMode: "read-only",
        workingDirectory: this.workingDirectory,
        skipGitRepoCheck: true,
        networkAccessEnabled: false,
        webSearchMode: "disabled",
        approvalPolicy: "never"
      });
      const result = await thread.run(codexPrompt(request), { signal: controller.signal });
      const text = result.finalResponse.trim();
      if (!text) {
        throw new Error("openai-codex-subscription returned no text");
      }
      const maxCharacters = Math.max(1024, request.maxTokens * 8);
      if (text.length > maxCharacters) {
        throw new Error("Codex subscription response exceeded the configured output limit");
      }
      return text;
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message === "openai-codex-subscription returned no text" ||
          error.message === "Codex subscription response exceeded the configured output limit")
      ) {
        throw error;
      }
      throw providerError(CODEX_SUBSCRIPTION_PROVIDER, "request", error);
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createTextGenerationClient(config: AppConfig): TextGenerationClient {
  if (config.LLM_PROVIDER === "openai-codex-subscription") {
    return new ObservedTextGenerationClient(
      new OpenAiCodexSubscriptionTextGenerationClient(config),
      config.OPENAI_CODEX_MODEL
    );
  }
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
