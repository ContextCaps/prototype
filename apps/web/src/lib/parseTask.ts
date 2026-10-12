/**
 * Reads the structured authorization values out of the free-text task.
 *
 * The broker is only ever sent the structured constraints, so Stage 1 has to
 * show which values it took from the sentence and let the person correct them
 * before anything is authorized. Nothing here decides authorization: a
 * disagreement is surfaced as a conflict instead of being resolved silently.
 */

export interface ParsedTask {
  destination?: string;
  budgetUsd?: number;
}

export const money = (value: number): string => `$${value.toLocaleString("en-US")}`;

/** Capitalized words that read like a place but never are. */
const NOT_A_PLACE = new Set([
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "january", "february", "march", "april", "may", "june", "july",
  "august", "september", "october", "november", "december",
  "book", "plan", "find", "next", "this", "my", "i", "ai", "usd",
]);

/** Connectors that may sit inside a place name ("Rio de Janeiro", "Newcastle upon Tyne"). */
const CONNECTORS = "de|del|della|la|le|los|van|der|upon|of";
const PLACE = `[A-Z][\\p{L}\\p{M}'’.-]+(?:\\s+(?:${CONNECTORS}|[A-Z][\\p{L}\\p{M}'’.-]+))*`;

const AFTER_PREPOSITION = new RegExp(`\\b(?:to|in|at)\\s+(${PLACE})`, "gu");
const BEFORE_TRIP = new RegExp(`(${PLACE})\\s+(?:trip|holiday|vacation|getaway)\\b`, "gu");

const DOLLARS = /\$\s*(\d[\d,]*(?:\.\d{1,2})?)/u;
const SPELLED_OUT = /\b(\d[\d,]*(?:\.\d{1,2})?)\s*(?:usd|dollars?)\b/iu;

function cleanPlace(raw: string): string | undefined {
  const place = raw
    .replace(/[\s,.;:]+$/u, "")
    .replace(new RegExp(`\\s+(?:${CONNECTORS})$`, "iu"), "")
    .trim();
  if (!place) return undefined;
  const firstWord = place.split(/\s+/)[0]?.toLowerCase() ?? "";
  return NOT_A_PLACE.has(firstWord) ? undefined : place;
}

function findDestination(text: string): string | undefined {
  for (const pattern of [AFTER_PREPOSITION, BEFORE_TRIP]) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const place = cleanPlace(match[1] ?? "");
      if (place) return place;
    }
  }
  return undefined;
}

function findBudget(text: string): number | undefined {
  const match = DOLLARS.exec(text) ?? SPELLED_OUT.exec(text);
  if (!match?.[1]) return undefined;
  const value = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

export function parseTask(text: string): ParsedTask {
  return { destination: findDestination(text), budgetUsd: findBudget(text) };
}

export interface TaskConflict {
  field: "destination" | "budget";
  label: string;
  /** What the task sentence says. */
  fromTask: string;
  /** What would be authorized right now. */
  current: string;
}

const sameText = (a: string, b: string): boolean =>
  a.trim().replace(/\s+/g, " ").toLowerCase() === b.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Compares the sentence against the values that would actually be authorized.
 * Only values the task states are compared, so a task that never mentions a
 * budget never conflicts with one.
 */
export function detectConflicts(
  parsed: ParsedTask,
  current: { destination: string; budgetUsd: number | null },
): TaskConflict[] {
  const conflicts: TaskConflict[] = [];
  if (parsed.destination && !sameText(parsed.destination, current.destination)) {
    conflicts.push({
      field: "destination",
      label: "Destination",
      fromTask: parsed.destination,
      current: current.destination.trim() || "Not set",
    });
  }
  if (parsed.budgetUsd !== undefined && parsed.budgetUsd !== current.budgetUsd) {
    conflicts.push({
      field: "budget",
      label: "Budget",
      fromTask: money(parsed.budgetUsd),
      current: current.budgetUsd === null ? "Not set" : money(current.budgetUsd),
    });
  }
  return conflicts;
}

/** Stable identity of one disagreement, so "Keep current values" stays resolved until something changes. */
export const conflictSignature = (conflicts: TaskConflict[]): string =>
  conflicts.map((c) => `${c.field}:${c.fromTask}>${c.current}`).join("|");
