import type { AppConfig } from "../../config.js";
import {
  createTextGenerationClient,
  type TextGenerationClient
} from "../llm/text-generation-client.js";

const QUERY_REWRITE_PROMPT =
  "Expand this search query adding synonyms, related terms, and variations. Keep original intent. Reply only with the expanded query.";

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
    const text = (await this.llm.complete({
      operation: "query-rewrite",
      system: QUERY_REWRITE_PROMPT,
      user: query,
      maxTokens: 300
    })).trim();

    return text || query;
  }
}
