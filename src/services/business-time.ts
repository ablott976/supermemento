/**
 * Business timezone for validity dates (validFrom / validTo).
 *
 * The backend and Neo4j run in UTC. A date without a time ("2026-09-11") means a
 * business day in Europe/Madrid, not an instant: validFrom starts at 00:00 local
 * and validTo lasts until 23:59:59.999 local. Normalising date-only values to
 * midnight UTC made a memory that "expires today" read as expired from 02:00
 * Madrid (01:00 in winter), the whole business day. This module is the single
 * place where the zone is declared; every validity date goes through it.
 */

const DEFAULT_BUSINESS_TIMEZONE = "Europe/Madrid";
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

function resolveBusinessTimezone(): string {
  const configured = process.env.BUSINESS_TIMEZONE?.trim() || DEFAULT_BUSINESS_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: configured });
  } catch {
    throw new Error(`BUSINESS_TIMEZONE is not a valid IANA timezone: ${configured}`);
  }
  return configured;
}

/** IANA timezone in which date-only validity values are interpreted. */
export const BUSINESS_TIMEZONE = resolveBusinessTimezone();

/** Offset (ms) of `timeZone` from UTC at the given instant, computed with Intl (Node ships full ICU). */
function timezoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  }).formatToParts(instant);
  const read = (type: string): number => Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(read("year"), read("month") - 1, read("day"), read("hour"), read("minute"), read("second"));
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * Converts a wall-clock time in `timeZone` to the corresponding UTC instant.
 * Two passes cover DST transitions, where the offset at the guess differs from the offset at the result.
 */
export function zonedTimeToUtc(
  year: number, month: number, day: number,
  hour: number, minute: number, second: number, millisecond: number,
  timeZone: string = BUSINESS_TIMEZONE
): Date {
  const wallClock = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  const firstGuess = wallClock - timezoneOffsetMs(new Date(wallClock), timeZone);
  const corrected = wallClock - timezoneOffsetMs(new Date(firstGuess), timeZone);
  return new Date(corrected);
}

function dateOnlyParts(value: string): [number, number, number] | null {
  const match = DATE_ONLY.exec(value);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * validFrom: a date without time is the START of that business day (00:00 in the business
 * timezone) as a UTC ISO instant. Any other value is returned unchanged.
 * @param value Raw validFrom from a tool argument, the extractor or document metadata.
 */
export function normalizeValidFrom<T extends string | null | undefined>(value: T): T | string {
  if (!value) return value;
  const parts = dateOnlyParts(value);
  if (!parts) return value;
  return zonedTimeToUtc(...parts, 0, 0, 0, 0).toISOString();
}

/**
 * validTo: a date without time is the END of that business day (23:59:59.999 in the business
 * timezone) as a UTC ISO instant, so a memory that "expires today" stays valid until Madrid midnight.
 * Any other value is returned unchanged.
 * @param value Raw validTo from a tool argument, the extractor or document metadata.
 */
export function normalizeValidTo<T extends string | null | undefined>(value: T): T | string {
  if (!value) return value;
  const parts = dateOnlyParts(value);
  if (!parts) return value;
  return zonedTimeToUtc(...parts, 23, 59, 59, 999).toISOString();
}

/** Calendar date (YYYY-MM-DD) of an instant in the business timezone. */
export function businessDate(instant: Date = new Date(), timeZone: string = BUSINESS_TIMEZONE): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
}

const MIDNIGHT_UTC = /^(\d{4}-\d{2}-\d{2})T00:00:00(?:\.0+)?(?:Z|\+00:00)$/;

/**
 * Plans the normalisation of a memory stored before MEM-05: a validity instant at exactly
 * midnight UTC came from a date-only value (the extractor and the tools produced nothing else),
 * so the intended meaning is that calendar day in the business timezone. validFrom moves to
 * the start of the day, validTo to its end. Anything not at midnight UTC is kept as it is.
 * @param stored ISO values currently stored on the node.
 * @returns The new values, or null when neither changes.
 */
export function planStoredValidityNormalization(stored: {
  validFrom: string | null;
  validTo: string | null;
}): { validFrom: string | null; validTo: string | null } | null {
  const fromDay = stored.validFrom ? MIDNIGHT_UTC.exec(stored.validFrom)?.[1] : undefined;
  const toDay = stored.validTo ? MIDNIGHT_UTC.exec(stored.validTo)?.[1] : undefined;
  if (!fromDay && !toDay) return null;
  return {
    validFrom: fromDay ? normalizeValidFrom(fromDay) : stored.validFrom,
    validTo: toDay ? normalizeValidTo(toDay) : stored.validTo
  };
}
