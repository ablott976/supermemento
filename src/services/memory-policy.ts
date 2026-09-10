import { createHash } from "node:crypto";
import type { Metadata } from "../types/models.js";

/**
 * Temporal classes declared by whoever creates a memory. Anything other than
 * "none" is intelligence that expires and therefore requires validTo.
 * Classification is never inferred from the content: keyword heuristics produce
 * false positives and block legitimate memories.
 */
export const TEMPORAL_CLASSES = ["pricing", "roadmap", "pipeline", "none"] as const;
export type TemporalClass = (typeof TEMPORAL_CLASSES)[number];

/** Metadata key that carries the declared temporal class on memories and documents. */
export const TEMPORAL_CLASS_METADATA_KEY = "temporal_class";
/** Document metadata key with the default validTo applied to every memory extracted by ingestion. */
export const VALID_TO_METADATA_KEY = "valid_to";

export type MemoryPolicyErrorCode = "invalid_temporal_class" | "validTo_required";

/** Validation failure raised before any write happens. */
export class MemoryPolicyError extends Error {
  public readonly code: MemoryPolicyErrorCode;

  public constructor(code: MemoryPolicyErrorCode, message: string) {
    super(message);
    this.name = "MemoryPolicyError";
    this.code = code;
  }
}

/**
 * Normalises memory content for exact-duplicate detection: Unicode NFKC,
 * lowercase, every run of characters that is not a letter or a digit becomes a
 * single space, then trim. Diacritics are preserved ("año" and "ano" differ).
 * @param content Raw memory content.
 */
export function normalizeMemoryContent(content: string): string {
  return content
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Stable hash used to detect exact duplicates inside one container.
 * @param containerTag Container namespace.
 * @param content Raw memory content.
 */
export function memoryContentHash(containerTag: string, content: string): string {
  return createHash("sha256")
    .update(`${containerTag}\n${normalizeMemoryContent(content)}`, "utf8")
    .digest("hex");
}

function isTemporalClass(value: unknown): value is TemporalClass {
  return typeof value === "string" && (TEMPORAL_CLASSES as readonly string[]).includes(value);
}

/**
 * Resolves the declared temporal class from the explicit argument or, failing
 * that, from metadata.temporal_class. Missing means "none".
 * @param explicit Value of the temporal_class tool argument.
 * @param metadata Caller-supplied metadata object.
 */
export function resolveTemporalClass(explicit: unknown, metadata?: Metadata | null): TemporalClass {
  const raw = explicit ?? metadata?.[TEMPORAL_CLASS_METADATA_KEY] ?? "none";
  if (!isTemporalClass(raw)) {
    throw new MemoryPolicyError(
      "invalid_temporal_class",
      `temporal_class must be one of ${TEMPORAL_CLASSES.join(", ")}`
    );
  }
  return raw;
}

/**
 * Server-side rule: temporal_class != "none" => validTo is mandatory.
 * @param temporalClass Declared temporal class.
 * @param validTo Resolved validTo (ISO datetime) or nothing.
 */
export function assertValidToForTemporalClass(
  temporalClass: TemporalClass,
  validTo: string | null | undefined
): void {
  if (temporalClass !== "none" && !validTo) {
    throw new MemoryPolicyError(
      "validTo_required",
      `validTo is required when temporal_class is ${temporalClass}`
    );
  }
}

/**
 * Returns metadata with the declared temporal class recorded explicitly.
 * @param metadata Caller-supplied metadata.
 * @param temporalClass Declared temporal class.
 */
export function withTemporalClass(metadata: Metadata | undefined, temporalClass: TemporalClass): Metadata {
  return { ...(metadata ?? {}), [TEMPORAL_CLASS_METADATA_KEY]: temporalClass };
}

/**
 * Reads the temporal class and default validTo recorded on a document's metadata
 * by the ingestion tools. Legacy documents without the keys behave as "none".
 * @param metadata Document metadata object.
 */
export function documentTemporalPolicy(metadata: Metadata | null | undefined): {
  temporalClass: TemporalClass;
  validTo: string | null;
} {
  const temporalClass = resolveTemporalClass(undefined, metadata);
  const rawValidTo = metadata?.[VALID_TO_METADATA_KEY];
  const validTo = typeof rawValidTo === "string" && rawValidTo.trim() ? rawValidTo : null;
  return { temporalClass, validTo };
}
