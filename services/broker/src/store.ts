import type {
  AuditEntry,
  CapabilityId,
  ContextCapability,
  Delegation,
  LifecycleEvent,
  MandateId,
  TaskMandate,
} from "@contextcaps/shared-types";

export interface CapabilityRecord {
  capability: ContextCapability;
  registrationTxHash?: string;
  revocationTxHash?: string;
}

/**
 * In-memory broker state (MVP). Holds full capability definitions off-chain;
 * the trust layer holds the authoritative status + policy hash.
 */
export class BrokerStore {
  readonly mandates = new Map<MandateId, TaskMandate>();
  readonly capabilities = new Map<CapabilityId, CapabilityRecord>();
  readonly delegations: Delegation[] = [];
  readonly audit: AuditEntry[] = [];
  readonly lifecycle: LifecycleEvent[] = [];

  childrenOf(capabilityId: CapabilityId): CapabilityId[] {
    return this.delegations.filter((d) => d.parentCapabilityId === capabilityId).map((d) => d.childCapabilityId);
  }

  reset(): void {
    this.mandates.clear();
    this.capabilities.clear();
    this.delegations.length = 0;
    this.audit.length = 0;
    this.lifecycle.length = 0;
  }
}
