import type { AppConfig } from "../../config.js";
import {
  createTextGenerationClient,
  type TextGenerationClient
} from "../llm/text-generation-client.js";

const QUERY_REWRITE_PROMPT =
  "Expand this search query adding synonyms, related terms, and variations. Keep original intent. Reply only with the expanded query.";

function canFallBackToOriginalQuery(error: unknown): boolean {
  const candidate = error as {
    status?: unknown;
    failureType?: unknown;
    name?: unknown;
    message?: unknown;
  } | null;
  if (["auth", "rate_limit", "server", "timeout"].includes(String(candidate?.failureType))) {
    return true;
  }
  if (
    typeof candidate?.status === "number" &&
    (candidate.status === 401 ||
      candidate.status === 403 ||
      candidate.status === 408 ||
      candidate.status === 429 ||
      candidate.status >= 500)
  ) {
    return true;
  }
  const name = typeof candidate?.name === "string" ? candidate.name.toLowerCase() : "";
  const message = typeof candidate?.message === "string" ? candidate.message.toLowerCase() : "";
  return (
    name === "aborterror" ||
    /timed?\s*out|timeout|rate.?limit|usage limit|quota|too many requests|unauthori[sz]ed|forbidden|auth(?:entication)? failed|not logged in|login required|server error|service unavailable|bad gateway|gateway timeout|\b(?:401|403|408|429|5\d\d)\b/.test(
      message
    )
  );
}

/** Query rewriting helper based on the configured LLM. */
export class QueryRewriterService {
  private readonly llm: TextGenerationClient;

  /**
   * Creates query rewriter service.
   * @param config Parsed application configuration.
   */
  public constructor(config: AppConfig, llm?: TextGenerationClient) {
    this.llm = llm ?? createTextGenerationClient(config);
  }

  /**
   * Rewrites a query to improve recall.
   * @param query User query.
   */
  public async rewrite(query: string): Promise<string> {
    try {
      const text = (await this.llm.complete({
        operation: "query-rewrite",
        system: QUERY_REWRITE_PROMPT,
        user: query,
        maxTokens: 300
      })).trim();

      return text || query;
    } catch (error) {
      if (!canFallBackToOriginalQuery(error)) {
        throw error;
      }
      console.info(
        `[query-rewrite] provider=${this.llm.provider} outcome=fallback reason=transient_or_auth`
      );
      return query;
    }
  }
}
