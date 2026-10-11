import type {
  CapabilityId,
  CapabilityStatus,
  ChainTx,
  ContextCapability,
  Delegation,
  DisclosureReceipt,
} from "@contextcaps/shared-types";

export interface OnchainCapabilityState {
  capabilityId: CapabilityId;
  status: CapabilityStatus;
  policyHash: string;
  parentCapabilityId?: CapabilityId;
  expiresAt: string;
}

/**
 * Trust-layer boundary. The broker depends only on this interface:
 *  - MockCapabilityStateProvider: deterministic, in-memory (dev/tests/demo fallback)
 *  - ContractSdkCapabilityStateProvider: Person 1's Monad contract SDK
 *
 * Policy code never talks to the chain; the broker resolves state through
 * this provider on every request and hands the result to the pure policy engine.
 */
export interface CapabilityStateProvider {
  readonly name: string;
  registerCapability(capability: ContextCapability): Promise<ChainTx>;
  /** Registers the child capability and its parent/child linkage. */
  registerDelegation(delegation: Delegation, child: ContextCapability): Promise<ChainTx>;
  revokeCapability(capabilityId: CapabilityId): Promise<ChainTx>;
  /** Returns undefined when the capability is not registered. Throws when state cannot be read. */
  getCapabilityState(capabilityId: CapabilityId): Promise<OnchainCapabilityState | undefined>;
  anchorDisclosureReceipt(receipt: DisclosureReceipt): Promise<ChainTx>;
}

/** Decision codes for DisclosureReceiptAnchored.decisionCode (uint8). */
export const DECISION_CODES = { DENY: 0, DERIVE: 1, SELECT: 2, TOOL_BOUND: 3 } as const;
