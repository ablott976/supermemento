import { z } from "zod";
import type { AppConfig } from "../../config.js";
import { Neo4jClient } from "../../db/neo4j-client.js";
import { MemoryType } from "../../types/enums.js";
import type { Profile } from "../../types/models.js";
import {
  createTextGenerationClient,
  type TextGenerationClient
} from "../llm/text-generation-client.js";

const PROFILE_PROMPT = `Genera un perfil de usuario conciso basado en los hechos proporcionados. Divide en:
STATIC (hechos permanentes sobre identidad, rol, preferencias) y
DYNAMIC (proyectos activos, tareas recientes, contexto temporal).
El perfil debe ser útil como system prompt para un LLM que va a interactuar con este usuario.
Máximo 500 palabras.`;

const profileResponseSchema = z.object({
  static: z.string().min(1),
  dynamic: z.string().min(1)
});

/** User profile generation and caching service. */
export class ProfileService {
  private readonly neo4jClient: Neo4jClient;
  private readonly llm: TextGenerationClient;

  /**
   * Creates profile service.
   */
  public constructor(config: AppConfig, neo4jClient: Neo4jClient, llm?: TextGenerationClient) {
    this.neo4jClient = neo4jClient;
    this.llm = llm ?? createTextGenerationClient(config);
  }

  /**
   * Generates and persists profile for a container.
   * @param containerTag Container tag.
   */
  public async generateProfile(containerTag: string): Promise<Profile> {
    const allMemories = await this.neo4jClient.getLatestMemoriesByContainer(containerTag);

    // Limit to most recent 200 memories to avoid exceeding prompt/string limits
    const memories = allMemories.slice(-200);

    const grouped = {
      fact: memories.filter((memory) => memory.memoryType === MemoryType.Fact).map((m) => m.content),
      preference: memories.filter((memory) => memory.memoryType === MemoryType.Preference).map((m) => m.content),
      episode: memories.filter((memory) => memory.memoryType === MemoryType.Episode).map((m) => m.content),
      derived: memories.filter((memory) => memory.memoryType === MemoryType.Derived).map((m) => m.content)
    };

    const raw = await this.llm.complete({
      operation: "profile-generation",
      system: PROFILE_PROMPT,
      user: JSON.stringify(
        {
          containerTag,
          totalMemories: allMemories.length,
          sampledMemories: memories.length,
          memoriesByType: grouped
        },
        null,
        2
      ),
      maxTokens: 1200
    });

    const parsed = profileResponseSchema.parse(this.extractJson(raw));
    return this.neo4jClient.upsertProfile(
      containerTag,
      parsed.static,
      parsed.dynamic,
      new Date().toISOString()
    );
  }

  /**
   * Returns cached profile, generating one when missing.
   * @param containerTag Container tag.
   */
  public async getProfile(containerTag: string): Promise<Profile> {
    const cached = await this.neo4jClient.getProfile(containerTag);
    if (cached) {
      return cached;
    }

    return this.generateProfile(containerTag);
  }

  private extractJson(raw: string): unknown {
    const fenced = raw.match(/```json\s*([\s\S]*?)\s*```/i);
    if (fenced?.[1]) {
      return JSON.parse(fenced[1].trim());
    }

    try {
      return JSON.parse(raw.trim());
    } catch {
      const lines = raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

      const staticStart = lines.findIndex((line) => line.toUpperCase().startsWith("STATIC"));
      const dynamicStart = lines.findIndex((line) => line.toUpperCase().startsWith("DYNAMIC"));

      const staticLines =
        staticStart >= 0
          ? lines.slice(staticStart + 1, dynamicStart >= 0 ? dynamicStart : lines.length)
          : lines.slice(0, Math.ceil(lines.length / 2));
      const dynamicLines =
        dynamicStart >= 0
          ? lines.slice(dynamicStart + 1)
          : lines.slice(Math.ceil(lines.length / 2));

      return {
        static: staticLines.join(" "),
        dynamic: dynamicLines.join(" ")
      };
    }
  }
}
