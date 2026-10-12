/**
 * Web-side view of broker payloads.
 *
 * Shared DTOs come from @contextcaps/shared-types. The agent-run shapes below
 * mirror services/agent (AgentRunResult, TraceEntry, Visible*) because that
 * package pulls in Node-only modules; keep them in sync with
 * services/agent/src/travelAgent.ts and services/agent/src/session.ts.
 */
import type { DisclosureMode } from "@contextcaps/shared-types";

export type {
  AuditEntry,
  AuditResponse,
  CapabilityStateResponse,
  ContextCapability,
  ContextPermission,
  CreateMandateRequest,
  CreateMandateResponse,
  Delegation,
  DisclosureMode,
  DisclosureReceipt,
  LifecycleEvent,
  PendingMandateResponse,
  PrepareRevocationResponse,
  TaskMandate,
  ToolBoundHandle,
  WalletSignRequest,
} from "@contextcaps/shared-types";

export interface HealthResponse {
  ok: boolean;
  provider: "mock" | "monad";
  /** "wallet": the user's own wallet signs authorization and revocation. Absent on older brokers. */
  principalSigning?: "server" | "wallet";
  llmPlanner: "available" | "unavailable";
}

export interface ContextAsk {
  resource: string;
  operation: string;
  requestedMode?: DisclosureMode;
  parameters?: Record<string, unknown>;
  audience?: string;
}

export interface VisibleDecision {
  decision: DisclosureMode;
  allowed: boolean;
  reasonCode: string;
  reason: string;
  result?: unknown;
  receiptId: string;
}

export interface VisibleDelegation {
  allowed: boolean;
  childCapabilityId?: string;
  reasonCode?: string;
  reason?: string;
}

export type TraceEntry =
  | { seq: number; agentId: string; kind: "task"; text: string }
  | { seq: number; agentId: string; kind: "note"; text: string }
  | { seq: number; agentId: string; kind: "external_content"; source: string; text: string; untrusted: true }
  | { seq: number; agentId: string; kind: "tool_call"; tool: "requestContext"; input: ContextAsk; output: VisibleDecision }
  | { seq: number; agentId: string; kind: "tool_call"; tool: "delegateContext"; input: { childAgentId: string }; output: VisibleDelegation }
  | { seq: number; agentId: string; kind: "tool_call"; tool: "bookHotel"; input: Record<string, unknown>; output: VisibleDecision }
  | { seq: number; agentId: string; kind: "tool_call"; tool: "searchHotels"; input: { destination: string }; output: unknown };

export interface HotelBooking {
  offerId: string;
  hotelName: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  totalUsd: number;
  reference: string;
}

export interface AgentRunRequest {
  mandateId: string;
  scenario?: "golden" | "retry";
  planner?: "scripted" | "llm";
  injection?: "deals_page" | "hotel_description" | "tool_response" | "booking_page";
}

export interface AgentRunResult {
  scenario: "golden" | "retry";
  planner: "scripted" | "llm" | "scripted-fallback";
  status: "BOOKED" | "HALTED_BY_POLICY" | "NO_BOOKING" | "PLANNER_ERROR";
  fallbackReason?: string;
  haltReasonCode?: string;
  summary: string;
  booking?: HotelBooking;
  childCapabilityId?: string;
  trace: TraceEntry[];
}
