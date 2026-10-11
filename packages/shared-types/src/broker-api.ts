/**
 * Broker API payloads — ADDITIVE extension (owner: Person 2).
 *
 * docs/01_ARCHITECTURE_AND_CONTRACTS.md §9 names the endpoints but not every
 * request/response body. These DTOs pin them down so the web app (Person 3),
 * the broker and the agent runtime share one definition. The frozen §6 types
 * in ./index.ts are reused unchanged.
 */
import type {
  AgentId,
  CapabilityId,
  CapabilityStatus,
  ContextCapability,
  ContextPermission,
  Delegation,
  DisclosureMode,
  DisclosureReceipt,
  MandateId,
  ReceiptId,
  TaskMandate,
} from "./index";

export interface ChainTx {
  txHash: string;
  explorerUrl?: string;
}

/**
 * Agent session — server-side identity binding.
 * `sessionId` is an unguessable bearer token. Agent-facing endpoints take it in
 * the `x-contextcaps-session` header (or `Authorization: Bearer <sessionId>`)
 * and resolve agentId / mandateId / capabilityId / purpose from it.
 * Treat it as a credential: never put it into LLM context.
 */
export interface AgentSessionGrant {
  sessionId: string;
  agentId: AgentId;
  mandateId: MandateId;
  capabilityId: CapabilityId;
  purpose: string;
  expiresAt: string;
}

/** Identity fields a session-bound body MAY repeat; if present they must match the session. */
export interface SessionIdentityEcho {
  mandateId?: MandateId;
  capabilityId?: CapabilityId;
  agentId?: AgentId;
}

// POST /api/v1/context/request (session-bound)
export interface SessionContextRequest extends SessionIdentityEcho {
  requestId?: string;
  /** Defaults to the session's purpose; a different value is denied PURPOSE_MISMATCH. */
  purpose?: string;
  resource: string;
  operation: string;
  requestedMode?: DisclosureMode;
  parameters?: Record<string, unknown>;
  audience?: string;
  timestamp?: string;
}

// POST /api/v1/delegations (session-bound; the session is the PARENT)
export interface SessionDelegationRequest extends SessionIdentityEcho {
  childAgentId: AgentId;
  purpose?: string;
  permissions: ContextPermission[];
  expiresAt?: string;
  maxDelegationDepth?: number;
  /** Legacy echo of the parent; must match the session if present. */
  parentCapabilityId?: CapabilityId;
  parentAgentId?: AgentId;
}

// POST /api/v1/tools/:toolId/invoke (session-bound)
export interface SessionToolInvocationRequest extends SessionIdentityEcho {
  requestId?: string;
  purpose?: string;
  arguments: Record<string, unknown>;
}

// POST /api/v1/mandates
export interface CreateMandateRequest {
  principal: string;
  description: string;
  /** Defaults to "travel-booking" — selects the server-side capability template. */
  purpose?: string;
  constraints: {
    budgetUsd?: number;
    destination?: string;
    /** Defaults to now. */
    validFrom?: string;
    /** Defaults to now + 24h. Becomes the root capability's expiresAt. */
    validUntil?: string;
  };
}

export interface CreateMandateResponse {
  mandate: TaskMandate;
  capability: ContextCapability;
  chain: ChainTx;
  /** Session for the root agent (e.g. travel-agent). */
  session: AgentSessionGrant;
}

// POST /api/v1/delegations
export interface CreateDelegationRequest {
  mandateId: MandateId;
  parentCapabilityId: CapabilityId;
  parentAgentId: AgentId;
  childAgentId: AgentId;
  /** Must equal the parent capability's purpose. */
  purpose: string;
  permissions: ContextPermission[];
  /** Defaults to the parent's expiry; may not exceed it. */
  expiresAt?: string;
  maxDelegationDepth?: number;
}

/** 201 when allowed; 403 with the denial shape otherwise. */
export type CreateDelegationResponse =
  | { allowed: true; delegation: Delegation; capability: ContextCapability; chain: ChainTx; childSession: AgentSessionGrant }
  | { allowed: false; reasonCode: string; reason: string };

// GET /api/v1/capabilities/:id  and  POST /api/v1/capabilities/:id/revoke
export interface CapabilityStateResponse {
  /** `status` is the *effective* status: REVOKED/EXPIRED if any ancestor is. */
  capability: ContextCapability;
  chain: {
    provider: string;
    status: CapabilityStatus | "NOT_FOUND" | "UNAVAILABLE";
    registrationTxHash?: string;
    revocationTxHash?: string;
  };
  childCapabilityIds: CapabilityId[];
}

// POST /api/v1/tools/:toolId/invoke
export interface ToolInvocationRequest {
  requestId: string;
  mandateId: MandateId;
  capabilityId: CapabilityId;
  agentId: AgentId;
  purpose: string;
  /** Tool-specific arguments. Tool-bound values are passed as opaque handles. */
  arguments: Record<string, unknown>;
}

export interface ToolInvocationResult {
  requestId: string;
  toolId: string;
  allowed: boolean;
  decision: Extract<DisclosureMode, "DENY" | "TOOL_BOUND">;
  reasonCode: string;
  reason: string;
  /** Allowlisted, non-secret tool output only. */
  result?: Record<string, unknown>;
  receiptIds: ReceiptId[];
  timestamp: string;
}

/** Shape of `DisclosureDecision.result` for TOOL_BOUND decisions. */
export interface ToolBoundHandle {
  handle: string;
  resource: string;
  audience: string;
  expiresAt: string;
}

// GET /api/v1/audit?mandateId=...
export interface AuditEntry {
  receipt: DisclosureReceipt;
  allowed: boolean;
  reason: string;
  kind: "context_request" | "tool_invocation";
}

export interface LifecycleEvent {
  type: "MANDATE_CREATED" | "DELEGATION_CREATED" | "DELEGATION_REJECTED" | "CAPABILITY_REVOKED";
  mandateId: MandateId;
  capabilityId: CapabilityId;
  agentId?: AgentId;
  reasonCode?: string;
  reason?: string;
  chainTxHash?: string;
  timestamp: string;
}

export interface AuditResponse {
  mandateId: MandateId;
  entries: AuditEntry[];
  delegations: Delegation[];
  lifecycle: LifecycleEvent[];
}
