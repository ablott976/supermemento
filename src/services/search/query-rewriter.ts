import Anthropic from "@anthropic-ai/sdk";
import type { AppConfig } from "../../config.js";

const QUERY_REWRITE_PROMPT =
  "Expand this search query adding synonyms, related terms, and variations. Keep original intent. Reply only with the expanded query.";

/** Query rewriting helper based on Anthropic Haiku. */
export class QueryRewriterService {
  private readonly anthropic: Anthropic;
  private readonly model: string;

  /**
   * Creates query rewriter service.
   * @param config Parsed application configuration.
   */
  public constructor(config: AppConfig) {
    this.anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
    this.model = config.ANTHROPIC_MODEL;
  }

  /**
   * Rewrites a query to improve recall.
   * @param query User query.
   */
  public async rewrite(query: string): Promise<string> {
    const response = await this.anthropic.messages.create({
      model: this.model,
      max_tokens: 300,
      system: QUERY_REWRITE_PROMPT,
      messages: [{ role: "user", content: query }]
    });

    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();

    return text || query;
  }
}
