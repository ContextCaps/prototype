import { summarizeResult } from "./format";

/** Same broker values, with a compact local date format for visual flow cards. */
export function activityResult(resource: string, result: unknown): string | undefined {
  if (resource === "calendar.availability" && result && typeof result === "object") {
    const window = result as { available?: boolean; start?: string; end?: string };
    if (window.available && window.start && window.end) {
      const start = new Date(window.start);
      const end = new Date(window.end);
      if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
        const format = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
        return `${format.format(start)} → ${format.format(end)}`;
      }
    }
  }
  return summarizeResult(resource, result);
}
