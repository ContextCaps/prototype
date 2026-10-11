import { sha256Hex } from "@contextcaps/policy";
import type { CapabilityId, ChainTx, ContextCapability, Delegation, DisclosureReceipt } from "@contextcaps/shared-types";
import type { Clock } from "../runtime";
import { systemClock } from "../runtime";
import type { CapabilityStateProvider, OnchainCapabilityState } from "./stateProvider";

/**
 * Deterministic in-memory stand-in for the Monad CapabilityRegistry.
 * Mirrors the documented contract semantics: register, revoke, expiry,
 * delegation linkage, receipt anchoring. Tx hashes are deterministic.
 */
export class MockCapabilityStateProvider implements CapabilityStateProvider {
  readonly name = "mock";
  readonly anchoredReceipts: Array<{ receiptId: string; capabilityId: string; requestHash: string; resultHash?: string }> = [];
  readonly delegationLinks: Array<{ parentCapabilityId: string; childCapabilityId: string; childAgentId: string }> = [];
  #capabilities = new Map<CapabilityId, OnchainCapabilityState>();
  #nonce = 0;
  #clock: Clock;
  /** Test hook: simulate an unreachable chain. */
  unavailable = false;

  constructor(clock: Clock = systemClock) {
    this.#clock = clock;
  }

  async registerCapability(capability: ContextCapability): Promise<ChainTx> {
    if (this.#capabilities.has(capability.capabilityId)) throw new Error("capability already registered");
    this.#capabilities.set(capability.capabilityId, {
      capabilityId: capability.capabilityId,
      status: "ACTIVE",
      policyHash: capability.policyHash,
      parentCapabilityId: capability.parentCapabilityId,
      expiresAt: capability.expiresAt,
    });
    return this.#tx("register", capability.capabilityId);
  }

  async registerDelegation(delegation: Delegation, child: ContextCapability): Promise<ChainTx> {
    const parent = this.#capabilities.get(delegation.parentCapabilityId);
    if (!parent || parent.status !== "ACTIVE") throw new Error("parent capability not active");
    await this.registerCapability(child);
    this.delegationLinks.push({
      parentCapabilityId: delegation.parentCapabilityId,
      childCapabilityId: delegation.childCapabilityId,
      childAgentId: delegation.childAgentId,
    });
    return this.#tx("delegate", delegation.delegationId);
  }

  async revokeCapability(capabilityId: CapabilityId): Promise<ChainTx> {
    const state = this.#capabilities.get(capabilityId);
    if (!state) throw new Error("capability not registered");
    state.status = "REVOKED";
    return this.#tx("revoke", capabilityId);
  }

  async getCapabilityState(capabilityId: CapabilityId): Promise<OnchainCapabilityState | undefined> {
    if (this.unavailable) throw new Error("chain unavailable");
    const state = this.#capabilities.get(capabilityId);
    if (!state) return undefined;
    const expired = state.status === "ACTIVE" && this.#clock().getTime() >= Date.parse(state.expiresAt);
    return { ...state, status: expired ? "EXPIRED" : state.status };
  }

  async anchorDisclosureReceipt(receipt: DisclosureReceipt): Promise<ChainTx> {
    this.anchoredReceipts.push({
      receiptId: receipt.receiptId,
      capabilityId: receipt.capabilityId,
      requestHash: receipt.requestHash,
      resultHash: receipt.resultHash,
    });
    return this.#tx("anchor", receipt.receiptId);
  }

  reset(): void {
    this.#capabilities.clear();
    this.anchoredReceipts.length = 0;
    this.delegationLinks.length = 0;
    this.#nonce = 0;
    this.unavailable = false;
  }

  #tx(kind: string, id: string): ChainTx {
    this.#nonce += 1;
    return { txHash: sha256Hex(`mock:${kind}:${id}:${this.#nonce}`) };
  }
}
