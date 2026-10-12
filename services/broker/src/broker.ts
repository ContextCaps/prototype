import {
  canonicalJson,
  computePolicyHash,
  deny,
  sha256Hex,
  evaluateRequest,
  getCapabilityTemplate,
  PURPOSES,
  validateDelegation,
  type Allowance,
  type Denial,
  type PolicyVerdict,
} from "@contextcaps/policy";
import type {
  AgentSessionGrant,
  AuditResponse,
  CapabilityId,
  CapabilityStateResponse,
  ContextCapability,
  ContextRequest,
  CreateDelegationRequest,
  CreateDelegationResponse,
  CreateMandateRequest,
  CreateMandateResponse,
  Delegation,
  ChainTx,
  PendingMandateResponse,
  PrepareRevocationResponse,
  DisclosureDecision,
  SessionContextRequest,
  SessionDelegationRequest,
  SessionIdentityEcho,
  SessionToolInvocationRequest,
  TaskMandate,
  ToolBoundHandle,
  ToolInvocationRequest,
  ToolInvocationResult,
} from "@contextcaps/shared-types";
import { DerivationError, type ContextVault } from "@contextcaps/vault";
import type { CapabilityStateProvider, OnchainCapabilityState } from "./chain/stateProvider";
import { HANDLE_TTL_MS, HandleStore } from "./handles";
import { resolveContext } from "./lineage";
import { silentLogger, type SafeLogger } from "./logger";
import { DerivationQuota } from "./quota";
import { ReceiptLedger } from "./receipts";
import { randomIds, systemClock, type Clock, type IdGenerator } from "./runtime";
import { SessionStore } from "./sessions";
import { BrokerStore } from "./store";
import type { ToolConnector } from "./tools/connector";
import { ToolGateway } from "./tools/toolGateway";

export interface BrokerDeps {
  vault: ContextVault;
  provider: CapabilityStateProvider;
  connectors: ToolConnector[];
  /** Key for result commitments in receipts. */
  receiptKey: string;
  clock?: Clock;
  ids?: IdGenerator;
  logger?: SafeLogger;
  /**
   * Who signs root registration and revocation on the trust layer.
   * "server" (default): the broker's own signer. "wallet": the principal's wallet;
   * the broker prepares the call and verifies the result on-chain before acting.
   */
  principalSigning?: PrincipalSigning;
  /** Waits between on-chain confirmation reads (wallet mode). Injected by tests. */
  confirmation?: { attempts: number; delayMs: number };
}

export type PrincipalSigning = "server" | "wallet";

/** Thrown when a session token is missing or unknown (HTTP 401). No receipt: there is no authenticated identity. */
export class SessionError extends Error {
  constructor() {
    super("Unknown or missing agent session.");
    this.name = "SessionError";
  }
}

/** Thrown for malformed API input that never reaches policy evaluation. */
export class BrokerInputError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "BrokerInputError";
    this.status = status;
  }
}

const ZERO_HASH = "0x" + "0".repeat(64);
const DEFAULT_MANDATE_TTL_MS = 24 * 60 * 60 * 1000;
const TX_HASH = /^0x[0-9a-fA-F]{64}$/;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Context Broker — the single enforcement point between agents and private context.
 *
 *   agent → requestContext → resolve trust-layer state → pure policy → vault (derive/select)
 *                                                               └→ handle (tool-bound)
 *   every decision → DisclosureReceipt (hashes only) → anchored via provider
 */
export class ContextBroker {
  readonly store = new BrokerStore();
  readonly sessions = new SessionStore();
  readonly #vault: ContextVault;
  readonly #provider: CapabilityStateProvider;
  readonly #clock: Clock;
  readonly #ids: IdGenerator;
  readonly #logger: SafeLogger;
  readonly #handles = new HandleStore();
  readonly #quota = new DerivationQuota();
  readonly #ledger: ReceiptLedger;
  readonly #tools: ToolGateway;
  readonly principalSigning: PrincipalSigning;
  readonly #confirmation: { attempts: number; delayMs: number };
  /** Wallet mode: mandates prepared but not yet registered on-chain by the principal. */
  readonly #pending = new Map<string, { mandate: TaskMandate; capability: ContextCapability }>();

  constructor(deps: BrokerDeps) {
    this.principalSigning = deps.principalSigning ?? "server";
    this.#confirmation = deps.confirmation ?? { attempts: 15, delayMs: 1000 };
    this.#vault = deps.vault;
    this.#provider = deps.provider;
    this.#clock = deps.clock ?? systemClock;
    this.#ids = deps.ids ?? randomIds;
    this.#logger = deps.logger ?? silentLogger;
    this.#ledger = new ReceiptLedger({
      store: this.store,
      provider: this.#provider,
      ids: this.#ids,
      logger: this.#logger,
      receiptKey: deps.receiptKey,
    });
    this.#tools = new ToolGateway({
      store: this.store,
      provider: this.#provider,
      vault: this.#vault,
      handles: this.#handles,
      ledger: this.#ledger,
      logger: this.#logger,
      clock: this.#clock,
      connectors: deps.connectors,
    });
  }

  get providerName(): string {
    return this.#provider.name;
  }

  // ---------------------------------------------------------------- mandates

  async createMandate(input: CreateMandateRequest): Promise<CreateMandateResponse> {
    if (this.principalSigning === "wallet") {
      throw new BrokerInputError("This broker uses wallet signing: prepare the mandate, sign it, then confirm it.", 409);
    }
    const { mandate, capability } = this.#buildMandate(input);
    const chain = await this.#provider.registerCapability(capability);
    return this.#activateMandate(mandate, capability, chain);
  }

  /**
   * Wallet mode, step 1: builds the mandate and root capability and returns the
   * unsigned registry call for the principal's wallet. Nothing is active yet.
   */
  prepareMandate(input: CreateMandateRequest): PendingMandateResponse {
    const { mandate, capability } = this.#buildMandate(input);
    let signRequest;
    try {
      signRequest = this.#provider.prepareRegistration(capability);
    } catch {
      throw new BrokerInputError("principal must be the wallet address that will sign.");
    }
    this.#pending.set(mandate.mandateId, { mandate, capability });
    this.#logger.info("mandate.prepared", { mandateId: mandate.mandateId, capabilityId: capability.capabilityId });
    return { status: "AWAITING_SIGNATURE", mandate, capability: structuredClone(capability), signRequest };
  }

  /**
   * Wallet mode, step 2: activates a prepared mandate once the trust layer shows
   * the principal registered exactly the prepared capability. The tx hash is
   * recorded for display; authority comes from chain state, not from the caller.
   */
  async confirmMandate(mandateId: string, txHash: string): Promise<CreateMandateResponse | undefined> {
    const pending = this.#pending.get(mandateId);
    if (!pending) return undefined;
    if (!TX_HASH.test(txHash)) throw new BrokerInputError("txHash must be a 32-byte hex transaction hash.");
    const { capability } = pending;
    const state = await this.#awaitChainState(capability.capabilityId, (s) => s !== undefined);
    if (!state) throw new BrokerInputError("The capability is not registered on-chain yet.", 409);
    const matches =
      state.status === "ACTIVE" &&
      state.policyHash.toLowerCase() === capability.policyHash.toLowerCase() &&
      state.parentCapabilityId === undefined &&
      (state.principal === undefined || state.principal.toLowerCase() === capability.principal.toLowerCase());
    if (!matches) throw new BrokerInputError("The on-chain registration does not match the prepared capability.", 409);
    this.#pending.delete(mandateId);
    return this.#activateMandate(pending.mandate, capability, { txHash });
  }

  #buildMandate(input: CreateMandateRequest): { mandate: TaskMandate; capability: ContextCapability } {
    const purpose = input.purpose ?? PURPOSES.TRAVEL_BOOKING;
    const template = getCapabilityTemplate(purpose);
    if (!template) throw new BrokerInputError(`Unknown purpose '${purpose}'.`);

    const now = this.#clock();
    const validFrom = input.constraints.validFrom ?? now.toISOString();
    const validUntil = input.constraints.validUntil ?? new Date(now.getTime() + DEFAULT_MANDATE_TTL_MS).toISOString();
    if (Number.isNaN(Date.parse(validFrom)) || Number.isNaN(Date.parse(validUntil))) {
      throw new BrokerInputError("validFrom/validUntil must be ISO dates.");
    }
    if (Date.parse(validUntil) <= Math.max(Date.parse(validFrom), now.getTime())) {
      throw new BrokerInputError("validUntil must be in the future and after validFrom.");
    }

    const mandate: TaskMandate = {
      mandateId: this.#ids.next("mdt"),
      principal: input.principal,
      purpose,
      description: input.description,
      rootAgentId: template.rootAgentId,
      constraints: {
        budgetUsd: input.constraints.budgetUsd,
        destination: input.constraints.destination,
        validFrom: new Date(validFrom).toISOString(),
        validUntil: new Date(validUntil).toISOString(),
      },
      status: "ACTIVE",
    };

    const capability = this.#finalizeCapability({
      capabilityId: this.#ids.next("cap"),
      mandateId: mandate.mandateId,
      principal: mandate.principal,
      agentId: template.rootAgentId,
      purpose,
      permissions: template.permissions,
      delegationDepth: 0,
      maxDelegationDepth: template.maxDelegationDepth,
      validFrom: mandate.constraints.validFrom,
      expiresAt: mandate.constraints.validUntil,
    });
    return { mandate, capability };
  }

  #activateMandate(mandate: TaskMandate, capability: ContextCapability, chain: ChainTx): CreateMandateResponse {
    const now = this.#clock();
    this.store.mandates.set(mandate.mandateId, mandate);
    this.store.capabilities.set(capability.capabilityId, { capability, registrationTxHash: chain.txHash });
    this.store.lifecycle.push({
      eventId: this.#ids.next("evt"),
      type: "MANDATE_CREATED",
      mandateId: mandate.mandateId,
      capabilityId: capability.capabilityId,
      agentId: capability.agentId,
      chainTxHash: chain.txHash,
      timestamp: now.toISOString(),
    });
    this.#logger.info("mandate.created", {
      mandateId: mandate.mandateId,
      capabilityId: capability.capabilityId,
      agentId: capability.agentId,
      provider: this.#provider.name,
    });
    const session = this.sessions.issue(capability);
    return { mandate, capability: structuredClone(capability), chain, session };
  }

  // ---------------------------------------------------------- context requests

  /**
   * Trusted in-process entry point: the caller vouches for `request`'s identity
   * fields. The HTTP API and the agent runtime use `requestContextForSession`.
   */
  async requestContext(request: ContextRequest, forcedDenial?: Denial): Promise<DisclosureDecision> {
    const started = performance.now();
    const now = this.#clock();
    const ctx = await resolveContext(this.store, this.#provider, request.capabilityId, request.mandateId, now);
    const verdict: PolicyVerdict = forcedDenial ?? evaluateRequest(request, ctx);
    const { verdict: finalVerdict, result } = this.#disclose(verdict, request, now);

    const receipt = await this.#ledger.record({
      kind: "context_request",
      requestId: request.requestId,
      mandateId: request.mandateId,
      capabilityId: request.capabilityId,
      agentId: request.agentId,
      resource: request.resource,
      operation: request.operation,
      decision: finalVerdict.decision,
      reasonCode: finalVerdict.reasonCode,
      allowed: finalVerdict.allowed,
      reason: finalVerdict.reason,
      requestForHash: request,
      resultForHash: result,
      timestamp: now.toISOString(),
    });

    this.#logger.info("context.decision", {
      requestId: request.requestId,
      agentId: request.agentId,
      capabilityId: request.capabilityId,
      resource: request.resource,
      operation: request.operation,
      decision: finalVerdict.decision,
      reasonCode: finalVerdict.reasonCode,
      latencyMs: Math.round(performance.now() - started),
    });

    const decision: DisclosureDecision = {
      requestId: request.requestId,
      decision: finalVerdict.decision,
      allowed: finalVerdict.allowed,
      reasonCode: finalVerdict.reasonCode,
      reason: finalVerdict.reason,
      receiptId: receipt.receiptId,
      capabilityId: request.capabilityId,
      policyHash: ctx.lineage[0]?.capability.policyHash ?? ZERO_HASH,
      timestamp: now.toISOString(),
    };
    if (finalVerdict.allowed) decision.result = result;
    return decision;
  }

  /** Produces the minimum-disclosure result for an allowed verdict. Raw records never leave the vault. */
  #disclose(verdict: PolicyVerdict, request: ContextRequest, now: Date): { verdict: PolicyVerdict; result?: unknown } {
    if (!verdict.allowed) return { verdict };
    try {
      const limit = verdict.decision === "DERIVE" ? verdict.spec.maxUniqueQueries : undefined;
      if (limit !== undefined) {
        const key = DerivationQuota.queryKey(request.operation, verdict.parameters);
        const admission = this.#quota.admit(request.capabilityId, verdict.spec.resource, key, limit);
        if (admission.kind === "cached") return { verdict, result: admission.result };
        if (admission.kind === "exhausted") {
          return {
            verdict: deny("DERIVATION_QUOTA_EXCEEDED", `Unique-query limit (${limit}) for ${verdict.spec.resource} reached for this capability.`),
          };
        }
        const result = this.#produce(verdict, request, now);
        this.#quota.record(request.capabilityId, verdict.spec.resource, key, result);
        return { verdict, result };
      }
      return { verdict, result: this.#produce(verdict, request, now) };
    } catch (error) {
      const reason =
        error instanceof DerivationError
          ? `Request parameters are outside what can be derived (${error.code}).`
          : "Disclosure could not be produced; failing closed.";
      return { verdict: { allowed: false, decision: "DENY", reasonCode: "OUT_OF_SCOPE", reason } };
    }
  }

  #produce(verdict: Allowance, request: ContextRequest, now: Date): unknown {
    switch (verdict.decision) {
      case "DERIVE":
        return this.#vault.derive(verdict.spec.resource, verdict.parameters);
      case "SELECT":
        return this.#vault.select(verdict.spec.resource, verdict.fields ?? []);
      case "TOOL_BOUND": {
        const capability = this.store.capabilities.get(request.capabilityId)!.capability;
        const expiresMs = Math.min(now.getTime() + HANDLE_TTL_MS, Date.parse(capability.expiresAt));
        const binding = this.#handles.issue({
          mandateId: request.mandateId,
          capabilityId: request.capabilityId,
          agentId: request.agentId,
          resource: verdict.spec.resource,
          audience: verdict.audience!,
          expiresAt: new Date(expiresMs).toISOString(),
        });
        const handle: ToolBoundHandle = {
          handle: binding.handle,
          resource: binding.resource,
          audience: binding.audience,
          expiresAt: binding.expiresAt,
        };
        return handle;
      }
    }
  }

  // ------------------------------------------------------- session-bound API

  /** Context request whose identity is resolved from the session, never from the body. */
  async requestContextForSession(sessionId: string | undefined, body: SessionContextRequest): Promise<DisclosureDecision> {
    const session = this.#requireSession(sessionId);
    const request: ContextRequest = {
      requestId: body.requestId ?? this.#ids.next("req"),
      mandateId: session.mandateId,
      capabilityId: session.capabilityId,
      agentId: session.agentId,
      purpose: body.purpose ?? session.purpose,
      resource: body.resource,
      operation: body.operation,
      requestedMode: body.requestedMode,
      parameters: body.parameters,
      audience: body.audience,
      timestamp: body.timestamp ?? this.#clock().toISOString(),
    };
    return this.requestContext(request, identityMismatch(session, body));
  }

  /** Delegation from the session's capability (the session is the parent). */
  async delegateForSession(sessionId: string | undefined, body: SessionDelegationRequest): Promise<CreateDelegationResponse> {
    const session = this.#requireSession(sessionId);
    const mismatch = identityMismatch(session, {
      mandateId: body.mandateId,
      capabilityId: body.parentCapabilityId ?? body.capabilityId,
      agentId: body.parentAgentId ?? body.agentId,
    });
    const input: CreateDelegationRequest = {
      mandateId: session.mandateId,
      parentCapabilityId: session.capabilityId,
      parentAgentId: session.agentId,
      childAgentId: body.childAgentId,
      purpose: body.purpose ?? session.purpose,
      permissions: body.permissions,
      expiresAt: body.expiresAt,
      maxDelegationDepth: body.maxDelegationDepth,
    };
    return this.delegate(input, mismatch);
  }

  async invokeToolForSession(
    sessionId: string | undefined,
    toolId: string,
    body: SessionToolInvocationRequest,
  ): Promise<ToolInvocationResult> {
    const session = this.#requireSession(sessionId);
    const request: ToolInvocationRequest = {
      requestId: body.requestId ?? this.#ids.next("req"),
      mandateId: session.mandateId,
      capabilityId: session.capabilityId,
      agentId: session.agentId,
      purpose: body.purpose ?? session.purpose,
      arguments: body.arguments,
    };
    return this.#tools.invoke(toolId, request, identityMismatch(session, body));
  }

  /** Root agent session of a mandate — for the trusted in-process agent runner only. */
  rootSession(mandateId: string): AgentSessionGrant | undefined {
    for (const { capability } of this.store.capabilities.values()) {
      if (capability.mandateId === mandateId && capability.parentCapabilityId === undefined) {
        return this.sessions.rootSessionFor(mandateId, capability.capabilityId);
      }
    }
    return undefined;
  }

  #requireSession(sessionId: string | undefined): AgentSessionGrant {
    const session = this.sessions.resolve(sessionId);
    if (!session) {
      this.#logger.warn("session.rejected", {});
      throw new SessionError();
    }
    return session;
  }

  // ------------------------------------------------------------------- tools

  invokeTool(toolId: string, request: ToolInvocationRequest): Promise<ToolInvocationResult> {
    return this.#tools.invoke(toolId, request);
  }

  // -------------------------------------------------------------- delegation

  /** Trusted in-process entry point; the HTTP API uses `delegateForSession`. */
  async delegate(input: CreateDelegationRequest, forcedDenial?: Denial): Promise<CreateDelegationResponse> {
    const now = this.#clock();
    const ctx = await resolveContext(this.store, this.#provider, input.parentCapabilityId, input.mandateId, now);
    const verdict = forcedDenial ?? validateDelegation(input, ctx);
    const requestHash = sha256Hex(canonicalJson(input));

    if (!verdict.allowed) {
      this.store.lifecycle.push({
        eventId: this.#ids.next("evt"),
        type: "DELEGATION_REJECTED",
        requestHash,
        mandateId: input.mandateId,
        capabilityId: input.parentCapabilityId,
        agentId: input.childAgentId,
        reasonCode: verdict.reasonCode,
        reason: verdict.reason,
        timestamp: now.toISOString(),
      });
      this.#logger.info("delegation.rejected", {
        mandateId: input.mandateId,
        capabilityId: input.parentCapabilityId,
        agentId: input.childAgentId,
        reasonCode: verdict.reasonCode,
      });
      return { allowed: false, reasonCode: verdict.reasonCode, reason: verdict.reason };
    }

    const child = this.#finalizeCapability({ ...verdict.child, capabilityId: this.#ids.next("cap") });
    const delegation: Delegation = {
      delegationId: this.#ids.next("dlg"),
      mandateId: child.mandateId,
      parentCapabilityId: input.parentCapabilityId,
      childCapabilityId: child.capabilityId,
      parentAgentId: input.parentAgentId,
      childAgentId: child.agentId,
      purpose: child.purpose,
      createdAt: now.toISOString(),
    };

    const chain = await this.#provider.registerDelegation(delegation, child);
    this.store.capabilities.set(child.capabilityId, { capability: child, registrationTxHash: chain.txHash });
    this.store.delegations.push(delegation);
    this.store.lifecycle.push({
      eventId: this.#ids.next("evt"),
      type: "DELEGATION_CREATED",
      requestHash,
      delegationId: delegation.delegationId,
      mandateId: child.mandateId,
      capabilityId: child.capabilityId,
      agentId: child.agentId,
      chainTxHash: chain.txHash,
      timestamp: now.toISOString(),
    });
    this.#logger.info("delegation.created", {
      mandateId: child.mandateId,
      capabilityId: child.capabilityId,
      agentId: child.agentId,
    });
    const childSession = this.sessions.issue(child);
    return { allowed: true, delegation, capability: structuredClone(child), chain, childSession };
  }

  // -------------------------------------------------------------- lifecycle

  /** Wallet mode: the unsigned revocation for the principal's wallet. */
  prepareRevocation(capabilityId: CapabilityId): PrepareRevocationResponse | undefined {
    if (!this.store.capabilities.has(capabilityId)) return undefined;
    return { signRequest: this.#provider.prepareRevocation(capabilityId) };
  }

  /**
   * Server mode: the broker revokes on the trust layer. Wallet mode: the
   * principal already sent the revocation; it is recorded only once the chain
   * reports the capability REVOKED.
   */
  async revokeCapability(capabilityId: CapabilityId, walletTxHash?: string): Promise<CapabilityStateResponse | undefined> {
    const record = this.store.capabilities.get(capabilityId);
    if (!record) return undefined;

    if (record.capability.status !== "REVOKED") {
      let tx: ChainTx;
      if (this.principalSigning === "wallet") {
        if (!walletTxHash || !TX_HASH.test(walletTxHash)) {
          throw new BrokerInputError("Wallet signing: send the revocation from the principal's wallet, then pass its txHash.");
        }
        const state = await this.#awaitChainState(capabilityId, (s) => s?.status === "REVOKED");
        if (state?.status !== "REVOKED") throw new BrokerInputError("The capability is not revoked on-chain yet.", 409);
        tx = { txHash: walletTxHash };
      } else {
        tx = await this.#provider.revokeCapability(capabilityId);
      }
      record.capability.status = "REVOKED";
      record.revocationTxHash = tx.txHash;
      const mandate = this.store.mandates.get(record.capability.mandateId);
      if (mandate && record.capability.parentCapabilityId === undefined) mandate.status = "REVOKED";
      this.store.lifecycle.push({
        eventId: this.#ids.next("evt"),
        type: "CAPABILITY_REVOKED",
        mandateId: record.capability.mandateId,
        capabilityId,
        agentId: record.capability.agentId,
        chainTxHash: tx.txHash,
        timestamp: this.#clock().toISOString(),
      });
      this.#logger.info("capability.revoked", { capabilityId, mandateId: record.capability.mandateId });
    }
    return this.getCapability(capabilityId);
  }

  async getCapability(capabilityId: CapabilityId): Promise<CapabilityStateResponse | undefined> {
    const record = this.store.capabilities.get(capabilityId);
    if (!record) return undefined;
    const now = this.#clock();
    const ctx = await resolveContext(this.store, this.#provider, capabilityId, record.capability.mandateId, now);

    let effective = record.capability.status;
    if (ctx.lineage.some((v) => v.chainStatus === "REVOKED" || v.capability.status === "REVOKED")) {
      effective = "REVOKED";
    } else if (
      effective === "ACTIVE" &&
      ctx.lineage.some((v) => v.chainStatus === "EXPIRED" || now.getTime() >= Date.parse(v.capability.expiresAt))
    ) {
      effective = "EXPIRED";
    }

    return {
      capability: { ...structuredClone(record.capability), status: effective },
      chain: {
        provider: this.#provider.name,
        status: ctx.lineage[0]?.chainStatus ?? "NOT_FOUND",
        registrationTxHash: record.registrationTxHash,
        revocationTxHash: record.revocationTxHash,
      },
      childCapabilityIds: this.store.childrenOf(capabilityId),
    };
  }

  getAudit(mandateId: string): AuditResponse {
    return {
      mandateId,
      entries: this.store.audit.filter((e) => e.receipt.mandateId === mandateId).map((e) => structuredClone(e)),
      delegations: this.store.delegations.filter((d) => d.mandateId === mandateId).map((d) => ({ ...d })),
      lifecycle: this.store.lifecycle.filter((e) => e.mandateId === mandateId).map((e) => ({ ...e })),
    };
  }

  /** Clears broker state (demo reset). The vault and provider are reset by the caller. */
  reset(): void {
    this.#pending.clear();
    this.store.reset();
    this.sessions.reset();
    this.#quota.reset();
    this.#handles.reset();
  }

  /** Re-reads trust-layer state until `done` holds or attempts run out (RPC nodes can lag the wallet's). */
  async #awaitChainState(
    capabilityId: CapabilityId,
    done: (state: OnchainCapabilityState | undefined) => boolean,
  ): Promise<OnchainCapabilityState | undefined> {
    let state: OnchainCapabilityState | undefined;
    for (let attempt = 0; attempt < this.#confirmation.attempts; attempt++) {
      if (attempt > 0) await sleep(this.#confirmation.delayMs);
      try {
        state = await this.#provider.getCapabilityState(capabilityId);
      } catch {
        state = undefined;
      }
      if (done(state)) return state;
    }
    return state;
  }

  #finalizeCapability(fields: Omit<ContextCapability, "policyHash" | "status">): ContextCapability {
    return { ...fields, status: "ACTIVE", policyHash: computePolicyHash(fields) };
  }
}

/**
 * A session-bound body may echo identity fields (backward compatibility), but
 * they must match the session. A mismatch is an impersonation attempt: it is
 * denied and receipted rather than silently corrected.
 */
function identityMismatch(session: AgentSessionGrant, body: SessionIdentityEcho): Denial | undefined {
  if (body.agentId !== undefined && body.agentId !== session.agentId) {
    return { allowed: false, decision: "DENY", reasonCode: "AGENT_MISMATCH", reason: "Request claimed an agent identity other than its session's." };
  }
  if (
    (body.capabilityId !== undefined && body.capabilityId !== session.capabilityId) ||
    (body.mandateId !== undefined && body.mandateId !== session.mandateId)
  ) {
    return { allowed: false, decision: "DENY", reasonCode: "INVALID_CAPABILITY", reason: "Request referenced a capability other than its session's." };
  }
  return undefined;
}
