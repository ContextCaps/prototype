import type {
  CapabilityId,
  CapabilityStatus,
  ChainTx,
  ContextCapability,
  Delegation,
  DisclosureReceipt,
} from "@contextcaps/shared-types";
import { DECISION_CODES, type CapabilityStateProvider, type OnchainCapabilityState } from "./stateProvider";

/**
 * Structural view of Person 1's `ContextCapsContractClient`
 * (docs/01_ARCHITECTURE_AND_CONTRACTS.md §12).
 *
 * PERSON 1 HANDOFF — what the SDK must provide (blockchain-specific only):
 *  - Accept canonical application string IDs ("cap_0001", "rcpt_0007",
 *    "travel-agent") and encode them for the contract. Recommended encoding:
 *    `toBytes32Id(id)` = keccak256(UTF-8(id)) (see ./ids.ts). The broker never
 *    converts its domain to bytes32.
 *  - policyHash / requestHash / resultHash are already 0x-prefixed 32-byte hex.
 *  - getCapability: return null for unknown ids; report status as
 *    ACTIVE | REVOKED | EXPIRED | COMPLETED (EXPIRED once block time ≥ expiresAt);
 *    throw on RPC failure (the broker then fails closed).
 *  - Timestamps are ISO-8601 strings at this boundary; convert to uint64 seconds inside the SDK.
 *  - decisionCode: DENY 0, DERIVE 1, SELECT 2, TOOL_BOUND 3.
 *  - Verify with tests/broker/providerConformance.ts (runProviderConformance).
 *
 * Implemented by @contextcaps/contract-sdk. This structural interface also
 * allows deterministic test doubles without coupling the broker to ethers.
 */
export interface ContractClientLike {
  registerCapability(input: {
    capabilityId: string;
    principal: string;
    agentId: string;
    policyHash: string;
    parentCapabilityId?: string;
    expiresAt: string;
  }): Promise<{ txHash: string; explorerUrl?: string }>;
  revokeCapability(capabilityId: string): Promise<{ txHash: string; explorerUrl?: string }>;
  getCapability(capabilityId: string): Promise<{
    capabilityId: string;
    status: CapabilityStatus;
    policyHash: string;
    parentCapabilityId?: string;
    expiresAt: string;
  } | null>;
  isCapabilityActive(capabilityId: string): Promise<boolean>;
  registerDelegation(input: {
    parentCapabilityId: string;
    childCapabilityId: string;
    childAgentId: string;
  }): Promise<{ txHash: string; explorerUrl?: string }>;
  anchorDisclosureReceipt(receipt: {
    receiptId: string;
    capabilityId: string;
    requestHash: string;
    resultHash: string;
    decisionCode: number;
  }): Promise<{ txHash: string; explorerUrl?: string }>;
}

const ZERO_HASH = "0x" + "0".repeat(64);

export class ContractSdkCapabilityStateProvider implements CapabilityStateProvider {
  readonly name = "monad";
  readonly #client: ContractClientLike;

  constructor(client: ContractClientLike) {
    this.#client = client;
  }

  async registerCapability(capability: ContextCapability): Promise<ChainTx> {
    return this.#client.registerCapability({
      capabilityId: capability.capabilityId,
      principal: capability.principal,
      agentId: capability.agentId,
      policyHash: capability.policyHash,
      parentCapabilityId: capability.parentCapabilityId,
      expiresAt: capability.expiresAt,
    });
  }

  async registerDelegation(delegation: Delegation, child: ContextCapability): Promise<ChainTx> {
    await this.registerCapability(child);
    return this.#client.registerDelegation({
      parentCapabilityId: delegation.parentCapabilityId,
      childCapabilityId: delegation.childCapabilityId,
      childAgentId: delegation.childAgentId,
    });
  }

  async revokeCapability(capabilityId: CapabilityId): Promise<ChainTx> {
    return this.#client.revokeCapability(capabilityId);
  }

  async getCapabilityState(capabilityId: CapabilityId): Promise<OnchainCapabilityState | undefined> {
    const onchain = await this.#client.getCapability(capabilityId);
    if (!onchain) return undefined;
    return {
      capabilityId: onchain.capabilityId,
      status: onchain.status,
      policyHash: onchain.policyHash,
      parentCapabilityId: onchain.parentCapabilityId,
      expiresAt: onchain.expiresAt,
    };
  }

  async anchorDisclosureReceipt(receipt: DisclosureReceipt): Promise<ChainTx> {
    return this.#client.anchorDisclosureReceipt({
      receiptId: receipt.receiptId,
      capabilityId: receipt.capabilityId,
      requestHash: receipt.requestHash,
      resultHash: receipt.resultHash ?? ZERO_HASH,
      decisionCode: DECISION_CODES[receipt.decision],
    });
  }
}
