/**
 * Safe logger. It accepts only a fixed set of identifier/metadata fields, so
 * private values (passport number, salary, tokens, calendar contents, results,
 * parameters) cannot be logged through it by construction.
 */
export interface SafeLogFields {
  requestId?: string;
  mandateId?: string;
  capabilityId?: string;
  agentId?: string;
  resource?: string;
  operation?: string;
  toolId?: string;
  decision?: string;
  reasonCode?: string;
  latencyMs?: number;
  provider?: string;
}

export interface SafeLogger {
  info(event: string, fields?: SafeLogFields): void;
  warn(event: string, fields?: SafeLogFields): void;
}

const ALLOWED_KEYS: ReadonlyArray<keyof SafeLogFields> = [
  "requestId",
  "mandateId",
  "capabilityId",
  "agentId",
  "resource",
  "operation",
  "toolId",
  "decision",
  "reasonCode",
  "latencyMs",
  "provider",
];

/** Strips anything not in the allowlist, even if a caller bypasses the type. */
function sanitize(fields: SafeLogFields | undefined): SafeLogFields {
  const out: Record<string, unknown> = {};
  if (!fields) return out;
  for (const key of ALLOWED_KEYS) {
    const value = fields[key];
    if (typeof value === "string" || typeof value === "number") out[key] = value;
  }
  return out as SafeLogFields;
}

export function createLogger(sink: (line: string) => void = (line) => process.stdout.write(line + "\n")): SafeLogger {
  const emit = (level: string, event: string, fields?: SafeLogFields) =>
    sink(JSON.stringify({ level, event, ...sanitize(fields), ts: new Date().toISOString() }));
  return {
    info: (event, fields) => emit("info", event, fields),
    warn: (event, fields) => emit("warn", event, fields),
  };
}

export const silentLogger: SafeLogger = { info: () => {}, warn: () => {} };
