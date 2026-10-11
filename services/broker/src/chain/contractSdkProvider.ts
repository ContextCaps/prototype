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
 * The input/output shapes below are ASSUMED — §12 does not define
 * RegisterCapabilityInput / TxResult / OnchainCapability yet. When
 * `@contextcaps/contract-sdk` ships, replace this interface with its types
 * and adjust the mapping in this file only.
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
