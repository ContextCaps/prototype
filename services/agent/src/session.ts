import { randomUUID } from "node:crypto";
import { BOOKING_TOOL_ID } from "@contextcaps/policy";
import type { AgentId, AgentSessionGrant, CapabilityId, ContextPermission, DisclosureMode } from "@contextcaps/shared-types";
import { goldenEnvironment, type AgentEnvironment, type HotelOffer } from "./environment";
import type { BrokerPort } from "./port";
import type { Trace } from "./trace";

/** Non-secret view of who this session acts as (the token itself stays private). */
export interface SessionIdentity {
  agentId: AgentId;
  capabilityId: CapabilityId;
}

/** What the model may ask for. Identity/capability fields are NOT model-controlled. */
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

export interface BookHotelArgs {
  offerId: string;
  checkIn: string;
  checkOut: string;
  amountUsd: number;
  identityHandle: string;
  paymentHandle: string;
}

export interface VisibleDelegation {
  allowed: boolean;
  childCapabilityId?: CapabilityId;
  reasonCode?: string;
  reason?: string;
}

/** Reason codes after which an agent must stop: its authority is gone. */
export const HALTING_REASON_CODES: ReadonlySet<string> = new Set([
  "CAPABILITY_REVOKED",
  "CAPABILITY_EXPIRED",
  "INVALID_CAPABILITY",
  "AGENT_MISMATCH",
  "PURPOSE_MISMATCH",
]);

export class AuthorityRevokedError extends Error {
  readonly reasonCode: string;
  constructor(reasonCode: string, reason: string) {
    super(reason);
    this.name = "AuthorityRevokedError";
    this.reasonCode = reasonCode;
  }
}

/**
 * The tool surface an agent (scripted or LLM) is given.
 *
 * The session holds a broker-issued session token privately. Every broker call
 * sends only that token plus the ask; the broker resolves agentId /
 * capabilityId / mandateId / purpose server-side. The model can neither see
 * the token nor choose identity fields. Every call and response is recorded in
 * the LLM-visible trace.
 */
export class AgentSession {
  readonly identity: SessionIdentity;
  readonly #grant: AgentSessionGrant;
  readonly #port: BrokerPort;
  readonly #trace: Trace;
  readonly #clock: () => Date;
  readonly #env: AgentEnvironment;
  /** Child grants returned by delegation, keyed by child capability id. Never surfaced to the model. */
  readonly #childGrants = new Map<CapabilityId, AgentSessionGrant>();

  constructor(
    port: BrokerPort,
    grant: AgentSessionGrant,
    trace: Trace,
    options: { clock?: () => Date; environment?: AgentEnvironment } = {},
  ) {
    this.#port = port;
    this.#grant = { ...grant };
    this.identity = { agentId: grant.agentId, capabilityId: grant.capabilityId };
    this.#trace = trace;
    this.#clock = options.clock ?? (() => new Date());
    this.#env = options.environment ?? goldenEnvironment;
  }

  get environment(): AgentEnvironment {
    return this.#env;
  }

  async requestContext(ask: ContextAsk): Promise<VisibleDecision> {
    const decision = await this.#port.requestContextForSession(this.#grant.sessionId, {
      requestId: `req_${randomUUID()}`,
      resource: ask.resource,
      operation: ask.operation,
      requestedMode: ask.requestedMode,
      parameters: ask.parameters,
      audience: ask.audience,
      timestamp: this.#clock().toISOString(),
    });
    const visible: VisibleDecision = {
      decision: decision.decision,
      allowed: decision.allowed,
      reasonCode: decision.reasonCode,
      reason: decision.reason,
      receiptId: decision.receiptId,
    };
    if (decision.allowed) visible.result = decision.result;
    this.#trace.add({ agentId: this.identity.agentId, kind: "tool_call", tool: "requestContext", input: ask, output: visible });
    this.#haltIfAuthorityGone(visible);
    return visible;
  }

  async delegateContext(input: {
    childAgentId: AgentId;
    permissions: ContextPermission[];
    expiresAt?: string;
  }): Promise<VisibleDelegation> {
    const response = await this.#port.delegateForSession(this.#grant.sessionId, {
      childAgentId: input.childAgentId,
      permissions: input.permissions,
      expiresAt: input.expiresAt,
    });
    let visible: VisibleDelegation;
    if (response.allowed) {
      this.#childGrants.set(response.capability.capabilityId, response.childSession);
      visible = { allowed: true, childCapabilityId: response.capability.capabilityId };
    } else {
      visible = { allowed: false, reasonCode: response.reasonCode, reason: response.reason };
    }
    this.#trace.add({ agentId: this.identity.agentId, kind: "tool_call", tool: "delegateContext", input, output: visible });
    if (!response.allowed && HALTING_REASON_CODES.has(response.reasonCode)) {
      throw new AuthorityRevokedError(response.reasonCode, response.reason);
    }
    return visible;
  }

  /** Spawns a session for a child agent this session delegated to. */
  childSession(childCapabilityId: CapabilityId): AgentSession {
    const grant = this.#childGrants.get(childCapabilityId);
    if (!grant) throw new Error("No delegated session for that capability.");
    return new AgentSession(this.#port, grant, this.#trace, { clock: this.#clock, environment: this.#env });
  }

  async bookHotel(args: BookHotelArgs): Promise<VisibleDecision & { result?: Record<string, unknown> }> {
    const response = await this.#port.invokeToolForSession(this.#grant.sessionId, BOOKING_TOOL_ID, {
      requestId: `req_${randomUUID()}`,
      arguments: { ...args },
    });
    const visible = {
      decision: response.decision,
      allowed: response.allowed,
      reasonCode: response.reasonCode,
      reason: response.reason,
      receiptId: response.receiptIds[0] ?? "",
      result: response.result,
    };
    this.#trace.add({ agentId: this.identity.agentId, kind: "tool_call", tool: "bookHotel", input: args, output: visible });
    this.#haltIfAuthorityGone(visible);
    return visible;
  }

  browse(url: string): string {
    const text = this.#env.fetchWebPage(url);
    this.#trace.add({ agentId: this.identity.agentId, kind: "external_content", source: url, text, untrusted: true });
    return text;
  }

  searchHotels(destination: string): HotelOffer[] {
    const offers = this.#env.searchHotels(destination);
    this.#trace.add({ agentId: this.identity.agentId, kind: "tool_call", tool: "searchHotels", input: { destination }, output: offers });
    return offers;
  }

  note(text: string): void {
    this.#trace.add({ agentId: this.identity.agentId, kind: "note", text });
  }

  #haltIfAuthorityGone(decision: { allowed: boolean; reasonCode: string; reason: string }): void {
    if (!decision.allowed && HALTING_REASON_CODES.has(decision.reasonCode)) {
      throw new AuthorityRevokedError(decision.reasonCode, decision.reason);
    }
  }

  // The session token must never be serialized into traces or logs.
  toJSON(): SessionIdentity {
    return this.identity;
  }
}
