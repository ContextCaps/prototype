/**
 * ContextCaps shared types — SHARED / FROZEN.
 *
 * Transcribed verbatim from docs/01_ARCHITECTURE_AND_CONTRACTS.md §3–§8.
 * Do not change names, fields, or enum values without coordinating with
 * Person 1 (contracts/SDK), Person 2 (broker), and Person 3 (web).
 */

// §3 Shared IDs
export type CapabilityId = string;
export type MandateId = string;
export type AgentId = string;
export type ReceiptId = string;

export const AGENT_IDS = {
  TRAVEL: "travel-agent",
  HOTEL: "hotel-agent",
} as const;

// §4 Capability lifecycle
export type CapabilityStatus = "ACTIVE" | "REVOKED" | "EXPIRED" | "COMPLETED";

// §5 Disclosure modes
export type DisclosureMode = "DENY" | "DERIVE" | "SELECT" | "TOOL_BOUND";

export const DISCLOSURE_MODES: readonly DisclosureMode[] = ["DENY", "DERIVE", "SELECT", "TOOL_BOUND"];

// §6 Shared types
export interface TaskMandate {
  mandateId: string;
  principal: string;
  purpose: string;
  description: string;
  rootAgentId: AgentId;

  constraints: {
    budgetUsd?: number;
    destination?: string;
    validFrom: string;
    validUntil: string;
  };

  status: CapabilityStatus;
}

export interface ContextPermission {
  resource: string;
  allowedModes: DisclosureMode[];
  allowedOperations?: string[];
  allowedAudience?: string[];
  delegable: boolean;
}

export interface ContextCapability {
  capabilityId: CapabilityId;
  mandateId: MandateId;

  principal: string;
  agentId: AgentId;
  purpose: string;

  permissions: ContextPermission[];

  parentCapabilityId?: CapabilityId;
  delegationDepth: number;
  maxDelegationDepth: number;

  validFrom: string;
  expiresAt: string;

  status: CapabilityStatus;
  policyHash: string;
}

export interface ContextRequest {
  requestId: string;

  mandateId: MandateId;
  capabilityId: CapabilityId;
  agentId: AgentId;

  purpose: string;

  resource: string;
  operation: string;

  requestedMode?: DisclosureMode;
  parameters?: Record<string, unknown>;
  audience?: string;

  timestamp: string;
}

export interface DisclosureDecision {
  requestId: string;

  decision: DisclosureMode;
  allowed: boolean;

  reasonCode: string;
  reason: string;

  result?: unknown;

  receiptId: ReceiptId;
  capabilityId: CapabilityId;
  policyHash: string;

  timestamp: string;
}

export interface Delegation {
  delegationId: string;

  mandateId: MandateId;

  parentCapabilityId: CapabilityId;
  childCapabilityId: CapabilityId;

  parentAgentId: AgentId;
  childAgentId: AgentId;

  purpose: string;
  createdAt: string;
}

export interface DisclosureReceipt {
  receiptId: ReceiptId;

  requestId: string;
  mandateId: MandateId;
  capabilityId: CapabilityId;

  agentId: AgentId;

  resource: string;
  operation: string;

  decision: DisclosureMode;
  reasonCode: string;

  requestHash: string;
  resultHash?: string;

  timestamp: string;
  chainTxHash?: string;
}

// §7 Stable reason codes
export const REASON_CODES = [
  "ALLOW_DERIVED",
  "ALLOW_SELECTED",
  "ALLOW_TOOL_BOUND",

  "OUT_OF_SCOPE",
  "PURPOSE_MISMATCH",
  "AGENT_MISMATCH",
  "CAPABILITY_REVOKED",
  "CAPABILITY_EXPIRED",
  "INVALID_CAPABILITY",
  "MODE_NOT_ALLOWED",
  "AUDIENCE_NOT_ALLOWED",
  "DELEGATION_NOT_ALLOWED",
  "DELEGATION_SCOPE_ESCALATION",
  "DELEGATION_DEPTH_EXCEEDED",
  "RAW_DISCLOSURE_FORBIDDEN",
  "TOOL_NOT_ALLOWED",
] as const;

export type ReasonCode = (typeof REASON_CODES)[number];

// §8 MVP resources
export const RESOURCES = {
  PROFILE_LEGAL_NAME: "profile.legal_name",
  PASSPORT_RAW: "passport.raw",
  PASSPORT_VALIDITY: "passport.validity",
  CALENDAR_RAW: "calendar.raw",
  CALENDAR_AVAILABILITY: "calendar.availability",
  TRAVEL_HOTEL_PREFERENCES: "travel.hotel_preferences",
  SALARY_RAW: "salary.raw",
  PAYMENT_RAW: "payment.raw",
  PAYMENT_HANDLE: "payment.handle",
} as const;

export type ResourceName = (typeof RESOURCES)[keyof typeof RESOURCES];

// Broker API payloads (additive; see ./broker-api.ts)
export type * from "./broker-api";
