import type { DisclosureMode } from "../api/types";

/** Plain-language names for broker resources (docs/01 §8). */
const RESOURCE_LABELS: Record<string, string> = {
  "passport.raw": "Full passport",
  "passport.validity": "Passport eligibility",
  "calendar.raw": "Full calendar",
  "calendar.availability": "Available travel window",
  "travel.hotel_preferences": "Hotel preferences",
  "salary.raw": "Salary",
  "payment.raw": "Raw payment credentials",
  "payment.handle": "Payment credential",
  "profile.legal_name": "Legal name",
};

export const resourceLabel = (resource: string): string => RESOURCE_LABELS[resource] ?? resource;

export const AGENT_LABELS: Record<string, string> = {
  "travel-agent": "Travel Agent",
  "hotel-agent": "Hotel Agent",
};

export const agentLabel = (agentId: string): string => AGENT_LABELS[agentId] ?? agentId;

/** What the UI calls each disclosure mode. */
export const DECISION_LABELS: Record<DisclosureMode, string> = {
  DENY: "BLOCKED",
  DERIVE: "DERIVED",
  SELECT: "SELECTED",
  TOOL_BOUND: "TOOL-BOUND",
};

/** Human-readable reason codes (docs/01 §7 + DERIVATION_QUOTA_EXCEEDED). */
const REASON_TEXT: Record<string, string> = {
  ALLOW_DERIVED: "Only a derived fact was released",
  ALLOW_SELECTED: "Only approved fields were released",
  ALLOW_TOOL_BOUND: "Secret goes straight to the approved tool",
  OUT_OF_SCOPE: "Outside the authorized task",
  PURPOSE_MISMATCH: "Wrong purpose for this capability",
  AGENT_MISMATCH: "Agent is not the capability holder",
  CAPABILITY_REVOKED: "Access was revoked by the user",
  CAPABILITY_EXPIRED: "Capability has expired",
  INVALID_CAPABILITY: "Capability is not valid",
  MODE_NOT_ALLOWED: "Disclosure mode not permitted",
  AUDIENCE_NOT_ALLOWED: "Tool is not an approved recipient",
  DELEGATION_NOT_ALLOWED: "This access cannot be delegated",
  DELEGATION_SCOPE_ESCALATION: "Child asked for more than the parent has",
  DELEGATION_DEPTH_EXCEEDED: "Delegation chain is too deep",
  RAW_DISCLOSURE_FORBIDDEN: "Raw data never leaves the vault",
  TOOL_NOT_ALLOWED: "Tool is not approved for this task",
  DERIVATION_QUOTA_EXCEEDED: "Too many probing queries for this fact",
};

export const reasonText = (code: string): string => REASON_TEXT[code] ?? code;

/** Short, non-sensitive rendering of an allowed decision's result. */
export function summarizeResult(resource: string, result: unknown): string | undefined {
  if (!result || typeof result !== "object") return undefined;
  const r = result as Record<string, unknown>;
  if (resource === "passport.validity" && "valid" in r) return `valid = ${String(r.valid)}`;
  if (resource === "calendar.availability") {
    if (r.available !== true) return "no window available";
    return `${shortDateTime(String(r.start))} → ${shortDateTime(String(r.end))}`;
  }
  if (typeof r.handle === "string") return `handle ${truncate(r.handle)}`;
  const entries = Object.entries(r).filter(([, v]) => typeof v !== "object");
  return entries.length ? entries.map(([k, v]) => `${k}: ${String(v)}`).join(" · ") : undefined;
}

export function truncate(value: string, head = 8, tail = 4): string {
  return value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function shortDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function shortTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

const MONAD_EXPLORER = "https://testnet.monadscan.com";

/** Explorer link for a tx hash; only meaningful when the broker runs on Monad (mock hashes are not on any chain). */
export function explorerTxUrl(provider: string | undefined, txHash: string | undefined): string | undefined {
  if (provider !== "monad" || !txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) return undefined;
  return `${MONAD_EXPLORER}/tx/${txHash}`;
}
