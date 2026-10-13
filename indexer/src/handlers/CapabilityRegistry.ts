import { indexer } from "envio";

// keccak256(UTF-8(agentId)), the encoding the contract SDK uses for agent ids.
const AGENTS: Record<string, string> = {
  "0x29c3dd8a706dca45e09b46310d4718bc794e33555989ce147de008a0c0c6040d": "travel-agent",
  "0x300c2047dc2095fc90ab158d1968e7b1d6a6b6a919769dbfb7c31b8ba86b42a8": "hotel-agent",
};
const DECISIONS = ["DENY", "DERIVE", "SELECT", "TOOL_BOUND"] as const;
const ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000";
// With an inline selection only block.number is implicit; list everything the handlers read.
const TX_FIELDS = { block: ["timestamp"], transaction: ["hash"] } as const;

const key = (value: string) => value.toLowerCase();
const lifecycleId = (txHash: string, logIndex: number) => `${txHash}-${logIndex}`;

indexer.onEvent(
  { contract: "CapabilityRegistry", event: "CapabilityRegistered", fields: TX_FIELDS },
  async ({ event, context }) => {
    const id = key(event.params.capabilityId);
    const parentId = key(event.params.parentCapabilityId);
    const parent = parentId === ZERO_HASH ? undefined : await context.Capability.get(parentId);
    const agentIdHash = key(event.params.agentId);
    const txHash = event.transaction.hash;

    context.Capability.set({
      id,
      principal: key(event.params.principal),
      agentIdHash,
      agent: AGENTS[agentIdHash] ?? "unknown",
      policyHash: key(event.params.policyHash),
      parent_id: parent ? parent.id : undefined,
      depth: parent ? parent.depth + 1 : 0,
      expiresAt: event.params.expiresAt,
      status: "ACTIVE",
      delegationConfirmed: false,
      registeredAt: BigInt(event.block.timestamp),
      registeredBlock: event.block.number,
      registeredTx: txHash,
      revokedAt: undefined,
      revokedTx: undefined,
      completedAt: undefined,
      receiptCount: 0,
      denyCount: 0,
    });
    context.LifecycleEvent.set({
      id: lifecycleId(txHash, event.logIndex),
      kind: "REGISTERED",
      capability_id: id,
      principal: key(event.params.principal),
      timestamp: BigInt(event.block.timestamp),
      blockNumber: event.block.number,
      txHash,
    });
  },
);

indexer.onEvent(
  { contract: "CapabilityRegistry", event: "DelegationRegistered", fields: TX_FIELDS },
  async ({ event, context }) => {
    const id = key(event.params.childCapabilityId);
    const child = await context.Capability.get(id);
    if (child) context.Capability.set({ ...child, delegationConfirmed: true });
    context.LifecycleEvent.set({
      id: lifecycleId(event.transaction.hash, event.logIndex),
      kind: "DELEGATION_CONFIRMED",
      capability_id: id,
      principal: child?.principal,
      timestamp: BigInt(event.block.timestamp),
      blockNumber: event.block.number,
      txHash: event.transaction.hash,
    });
  },
);

indexer.onEvent(
  { contract: "CapabilityRegistry", event: "CapabilityRevoked", fields: TX_FIELDS },
  async ({ event, context }) => {
    const id = key(event.params.capabilityId);
    const capability = await context.Capability.get(id);
    if (capability) {
      context.Capability.set({
        ...capability,
        status: "REVOKED",
        revokedAt: BigInt(event.block.timestamp),
        revokedTx: event.transaction.hash,
      });
    }
    context.LifecycleEvent.set({
      id: lifecycleId(event.transaction.hash, event.logIndex),
      kind: "REVOKED",
      capability_id: id,
      principal: key(event.params.principal),
      timestamp: BigInt(event.block.timestamp),
      blockNumber: event.block.number,
      txHash: event.transaction.hash,
    });
  },
);

indexer.onEvent(
  { contract: "CapabilityRegistry", event: "CapabilityCompleted", fields: TX_FIELDS },
  async ({ event, context }) => {
    const id = key(event.params.capabilityId);
    const capability = await context.Capability.get(id);
    if (capability) {
      context.Capability.set({ ...capability, status: "COMPLETED", completedAt: BigInt(event.block.timestamp) });
    }
    context.LifecycleEvent.set({
      id: lifecycleId(event.transaction.hash, event.logIndex),
      kind: "COMPLETED",
      capability_id: id,
      principal: capability?.principal,
      timestamp: BigInt(event.block.timestamp),
      blockNumber: event.block.number,
      txHash: event.transaction.hash,
    });
  },
);

indexer.onEvent(
  { contract: "CapabilityRegistry", event: "DisclosureReceiptAnchored", fields: TX_FIELDS },
  async ({ event, context }) => {
    const capabilityId = key(event.params.capabilityId);
    const decisionCode = Number(event.params.decisionCode);
    context.Receipt.set({
      id: key(event.params.receiptId),
      capability_id: capabilityId,
      requestHash: key(event.params.requestHash),
      resultHash: key(event.params.resultHash),
      decisionCode,
      decision: DECISIONS[decisionCode] ?? "UNKNOWN",
      anchoredAt: BigInt(event.block.timestamp),
      anchoredBlock: event.block.number,
      txHash: event.transaction.hash,
    });
    const capability = await context.Capability.get(capabilityId);
    if (capability) {
      context.Capability.set({
        ...capability,
        receiptCount: capability.receiptCount + 1,
        denyCount: capability.denyCount + (decisionCode === 0 ? 1 : 0),
      });
    }
  },
);
