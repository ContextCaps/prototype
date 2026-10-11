import type { CapabilityView, EvaluationContext } from "@contextcaps/policy";
import type { CapabilityId, MandateId } from "@contextcaps/shared-types";
import type { CapabilityStateProvider } from "./chain/stateProvider";
import type { BrokerStore } from "./store";

const MAX_LINEAGE = 8;

/**
 * Builds the policy EvaluationContext for a capability: the local record plus
 * fresh trust-layer state for it and every ancestor. Called on EVERY request,
 * so revocation takes effect on the very next request. Read failures are
 * reported as UNAVAILABLE and the policy engine fails closed.
 */
export async function resolveContext(
  store: BrokerStore,
  provider: CapabilityStateProvider,
  capabilityId: CapabilityId,
  mandateId: MandateId,
  now: Date,
): Promise<EvaluationContext> {
  const lineage: CapabilityView[] = [];
  let cursor: CapabilityId | undefined = capabilityId;

  while (cursor !== undefined && lineage.length < MAX_LINEAGE) {
    const record = store.capabilities.get(cursor);
    if (!record) break;
    lineage.push(await viewOf(provider, record.capability));
    cursor = record.capability.parentCapabilityId;
  }
  // A dangling parent reference or an over-deep chain is treated as missing state.
  if (cursor !== undefined && lineage.length > 0) {
    lineage[lineage.length - 1] = { ...lineage[lineage.length - 1]!, chainStatus: "NOT_FOUND" };
  }

  const ownMandateId = lineage[0]?.capability.mandateId ?? mandateId;
  return { lineage, mandate: store.mandates.get(ownMandateId), now };
}

async function viewOf(
  provider: CapabilityStateProvider,
  capability: CapabilityView["capability"],
): Promise<CapabilityView> {
  try {
    const state = await provider.getCapabilityState(capability.capabilityId);
    if (!state) return { capability, chainStatus: "NOT_FOUND" };
    return { capability, chainStatus: state.status, chainPolicyHash: state.policyHash };
  } catch {
    return { capability, chainStatus: "UNAVAILABLE" };
  }
}
