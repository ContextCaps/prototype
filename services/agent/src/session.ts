import { randomUUID } from "node:crypto";
import { BOOKING_TOOL_ID } from "@contextcaps/policy";
import type { AgentId, CapabilityId, ContextPermission, DisclosureMode, MandateId } from "@contextcaps/shared-types";
import { fetchWebPage, searchHotels, type HotelOffer } from "./environment";
import type { BrokerPort } from "./port";
import type { Trace } from "./trace";

export interface SessionBinding {
  agentId: AgentId;
  mandateId: MandateId;
  capabilityId: CapabilityId;
  purpose: string;
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
 * The session binds agentId / mandateId / capabilityId / purpose — the model
 * cannot choose them, so a prompt-injected model cannot impersonate another
 * agent or borrow another capability through these tools. Every call and
 * every response is recorded in the LLM-visible trace.
 */
export class AgentSession {
  readonly binding: SessionBinding;
  readonly #port: BrokerPort;
  readonly #trace: Trace;
  readonly #clock: () => Date;

  constructor(port: BrokerPort, binding: SessionBinding, trace: Trace, clock: () => Date = () => new Date()) {
    this.#port = port;
    this.binding = binding;
    this.#trace = trace;
    this.#clock = clock;
  }

  async requestContext(ask: ContextAsk): Promise<VisibleDecision> {
    const decision = await this.#port.requestContext({
      requestId: `req_${randomUUID()}`,
      mandateId: this.binding.mandateId,
      capabilityId: this.binding.capabilityId,
      agentId: this.binding.agentId,
      purpose: this.binding.purpose,
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
    this.#trace.add({ agentId: this.binding.agentId, kind: "tool_call", tool: "requestContext", input: ask, output: visible });
    this.#haltIfAuthorityGone(visible);
    return visible;
  }

  async delegateContext(input: {
    childAgentId: AgentId;
    permissions: ContextPermission[];
    expiresAt?: string;
  }): Promise<{ allowed: boolean; childCapabilityId?: CapabilityId; reasonCode?: string; reason?: string }> {
    const response = await this.#port.delegate({
      mandateId: this.binding.mandateId,
      parentCapabilityId: this.binding.capabilityId,
      parentAgentId: this.binding.agentId,
      childAgentId: input.childAgentId,
      purpose: this.binding.purpose,
      permissions: input.permissions,
      expiresAt: input.expiresAt,
    });
    const visible = response.allowed
      ? { allowed: true, childCapabilityId: response.capability.capabilityId }
      : { allowed: false, reasonCode: response.reasonCode, reason: response.reason };
    this.#trace.add({ agentId: this.binding.agentId, kind: "tool_call", tool: "delegateContext", input, output: visible });
    if (!response.allowed && HALTING_REASON_CODES.has(response.reasonCode)) {
      throw new AuthorityRevokedError(response.reasonCode, response.reason);
    }
    return visible;
  }

  /** Spawns a session for a child agent bound to a delegated capability. */
  childSession(childAgentId: AgentId, childCapabilityId: CapabilityId): AgentSession {
    return new AgentSession(
      this.#port,
      { ...this.binding, agentId: childAgentId, capabilityId: childCapabilityId },
      this.#trace,
      this.#clock,
    );
  }

  async bookHotel(args: BookHotelArgs): Promise<VisibleDecision & { result?: Record<string, unknown> }> {
    const response = await this.#port.invokeTool(BOOKING_TOOL_ID, {
      requestId: `req_${randomUUID()}`,
      mandateId: this.binding.mandateId,
      capabilityId: this.binding.capabilityId,
      agentId: this.binding.agentId,
      purpose: this.binding.purpose,
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
    this.#trace.add({ agentId: this.binding.agentId, kind: "tool_call", tool: "bookHotel", input: args, output: visible });
    this.#haltIfAuthorityGone(visible);
    return visible;
  }

  browse(url: string): string {
    const text = fetchWebPage(url);
    this.#trace.add({ agentId: this.binding.agentId, kind: "external_content", source: url, text, untrusted: true });
    return text;
  }

  searchHotels(destination: string): HotelOffer[] {
    const offers = searchHotels(destination);
    this.#trace.add({ agentId: this.binding.agentId, kind: "tool_call", tool: "searchHotels", input: { destination }, output: offers });
    return offers;
  }

  note(text: string): void {
    this.#trace.add({ agentId: this.binding.agentId, kind: "note", text });
  }

  #haltIfAuthorityGone(decision: { allowed: boolean; reasonCode: string; reason: string }): void {
    if (!decision.allowed && HALTING_REASON_CODES.has(decision.reasonCode)) {
      throw new AuthorityRevokedError(decision.reasonCode, decision.reason);
    }
  }
}
