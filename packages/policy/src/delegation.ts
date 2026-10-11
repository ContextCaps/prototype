import type { AgentId, ContextCapability, ContextPermission } from "@contextcaps/shared-types";
import { getResourceSpec } from "./catalog";
import { deny, evaluateCapabilityState, type Denial, type EvaluationContext } from "./evaluate";

export interface DelegationProposal {
  mandateId: string;
  parentAgentId: AgentId;
  childAgentId: AgentId;
  purpose: string;
  permissions: ContextPermission[];
  /** Defaults to the parent's expiry. */
  expiresAt?: string;
  /** Defaults to the parent's max depth. */
  maxDelegationDepth?: number;
}

/** Child capability fields decided by attenuation (ids, hash and status are assigned by the broker). */
export type AttenuatedChild = Omit<ContextCapability, "capabilityId" | "policyHash" | "status">;

export type DelegationVerdict = { allowed: true; child: AttenuatedChild } | Denial;

/**
 * Enforces delegation attenuation (INV-07):
 *   child.permissions ⊆ parent.permissions (resource, modes, operations, audience)
 *   only delegable resources
 *   child.expiresAt <= parent.expiresAt
 *   depth within the parent's allowance
 *
 * `parentCtx.lineage[0]` is the parent capability.
 */
export function validateDelegation(proposal: DelegationProposal, parentCtx: EvaluationContext): DelegationVerdict {
  const stateDenial = evaluateCapabilityState(
    { mandateId: proposal.mandateId, agentId: proposal.parentAgentId, purpose: proposal.purpose },
    parentCtx,
  );
  if (stateDenial) return stateDenial;
  const parent = parentCtx.lineage[0]!.capability;

  const childDepth = parent.delegationDepth + 1;
  if (childDepth > parent.maxDelegationDepth) {
    return deny("DELEGATION_DEPTH_EXCEEDED", "Parent capability may not delegate further.");
  }
  const requestedMaxDepth = proposal.maxDelegationDepth ?? parent.maxDelegationDepth;
  if (!Number.isInteger(requestedMaxDepth) || requestedMaxDepth > parent.maxDelegationDepth) {
    return deny("DELEGATION_DEPTH_EXCEEDED", "Child delegation depth exceeds the parent's allowance.");
  }
  // A max below the child's own depth simply means "may not delegate further".
  const childMaxDepth = Math.max(requestedMaxDepth, childDepth);

  if (proposal.permissions.length === 0) {
    return deny("DELEGATION_NOT_ALLOWED", "A delegation must grant at least one permission.");
  }
  const seen = new Set<string>();
  const childPermissions: ContextPermission[] = [];
  for (const requested of proposal.permissions) {
    if (seen.has(requested.resource)) {
      return deny("DELEGATION_NOT_ALLOWED", "Duplicate resource in delegation.");
    }
    seen.add(requested.resource);

    const parentPermission = parent.permissions.find((p) => p.resource === requested.resource);
    if (!parentPermission || !getResourceSpec(requested.resource) || getResourceSpec(requested.resource)!.raw) {
      return deny("DELEGATION_SCOPE_ESCALATION", `Parent does not hold ${requested.resource}.`);
    }
    if (!parentPermission.delegable) {
      return deny("DELEGATION_NOT_ALLOWED", `${requested.resource} is not delegable.`);
    }
    const narrowed = narrowPermission(requested, parentPermission);
    if (!narrowed) {
      return deny("DELEGATION_SCOPE_ESCALATION", `Child permission for ${requested.resource} is broader than the parent's.`);
    }
    childPermissions.push(narrowed);
  }

  const expiresAt = proposal.expiresAt ?? parent.expiresAt;
  const expiresMs = Date.parse(expiresAt);
  if (Number.isNaN(expiresMs) || expiresMs > Date.parse(parent.expiresAt)) {
    return deny("DELEGATION_SCOPE_ESCALATION", "Child expiry may not exceed the parent's expiry.");
  }
  if (expiresMs <= parentCtx.now.getTime()) {
    return deny("DELEGATION_NOT_ALLOWED", "Child expiry is already in the past.");
  }

  return {
    allowed: true,
    child: {
      mandateId: parent.mandateId,
      principal: parent.principal,
      agentId: proposal.childAgentId,
      purpose: parent.purpose,
      permissions: childPermissions,
      parentCapabilityId: parent.capabilityId,
      delegationDepth: childDepth,
      maxDelegationDepth: childMaxDepth,
      validFrom: parentCtx.now.toISOString(),
      expiresAt: new Date(expiresMs).toISOString(),
    },
  };
}

/** Returns the child permission if it is a subset of the parent's, otherwise undefined. */
function narrowPermission(child: ContextPermission, parent: ContextPermission): ContextPermission | undefined {
  const modes = child.allowedModes.filter((m) => m !== "DENY");
  if (modes.length === 0 || !isSubset(modes, parent.allowedModes)) return undefined;

  const operations = child.allowedOperations ?? parent.allowedOperations;
  if (parent.allowedOperations && operations && !isSubset(operations, parent.allowedOperations)) return undefined;

  const audience = child.allowedAudience ?? parent.allowedAudience;
  if (parent.allowedAudience && audience && !isSubset(audience, parent.allowedAudience)) return undefined;

  const narrowed: ContextPermission = { resource: child.resource, allowedModes: modes, delegable: child.delegable };
  if (operations) narrowed.allowedOperations = [...operations];
  if (audience) narrowed.allowedAudience = [...audience];
  return narrowed;
}

function isSubset<T>(subset: readonly T[], superset: readonly T[]): boolean {
  return subset.every((item) => superset.includes(item));
}
