import type { CalendarEvent } from "../fixtures";
import { DerivationError, parseInstant } from "./errors";

export type AvailabilityResult = { available: true; start: string; end: string } | { available: false };

const HOUR_MS = 60 * 60 * 1000;
/** Bounds the query window so the calendar cannot be dumped with one wide request. */
export const MAX_AVAILABILITY_RANGE_DAYS = 14;

export interface AvailabilityRange {
  from: unknown;
  to: unknown;
  minHours?: unknown;
}

/**
 * Returns the first free window of at least `minHours` inside [from, to].
 * Only the window boundaries leave this function — never titles or event lists.
 */
export function calendarAvailableWindow(events: readonly CalendarEvent[], range: AvailabilityRange): AvailabilityResult {
  const from = parseInstant(range.from, "from");
  const to = parseInstant(range.to, "to");
  if (to.getTime() <= from.getTime()) {
    throw new DerivationError("INVALID_PARAMETER", "to must be after from");
  }
  if (to.getTime() - from.getTime() > MAX_AVAILABILITY_RANGE_DAYS * 24 * HOUR_MS) {
    throw new DerivationError("RANGE_TOO_WIDE", `range must be at most ${MAX_AVAILABILITY_RANGE_DAYS} days`);
  }
  const minHours = range.minHours === undefined ? 1 : range.minHours;
  if (typeof minHours !== "number" || !Number.isFinite(minHours) || minHours <= 0) {
    throw new DerivationError("INVALID_PARAMETER", "minHours must be a positive number");
  }
  const minMs = minHours * HOUR_MS;

  const busy = events
    .map((e) => ({ start: new Date(e.start).getTime(), end: new Date(e.end).getTime() }))
    .filter((b) => b.end > from.getTime() && b.start < to.getTime())
    .sort((a, b) => a.start - b.start);

  let cursor = from.getTime();
  for (const block of busy) {
    if (block.start - cursor >= minMs) {
      return window(cursor, block.start);
    }
    cursor = Math.max(cursor, block.end);
  }
  if (to.getTime() - cursor >= minMs) {
    return window(cursor, to.getTime());
  }
  return { available: false };
}

function window(start: number, end: number): AvailabilityResult {
  return { available: true, start: new Date(start).toISOString(), end: new Date(end).toISOString() };
}
