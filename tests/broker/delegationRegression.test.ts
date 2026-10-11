import {
  computePolicyHash,
  evaluateRequest,
  getCapabilityTemplate,
  OPERATIONS,
  PURPOSES,
  validateDelegation,
  type CapabilityView,
  type ChainStatus,
  type EvaluationContext,
} from "@contextcaps/policy";
import {
  AGENT_IDS,
  RESOURCES,
  type ContextCapability,
  type ContextPermission,
  type ContextRequest,
  type TaskMandate,
} from "@contextcaps/shared-types";
import { describe, expect, it } from "vitest";
import { availabilityAsk, makeHarness, NOW } from "./helpers";

// ---------------------------------------------------------------- fixtures

const mandate: TaskMandate = {
  mandateId: "mdt_1",
  principal: "0xA11CE",
  purpose: PURPOSES.TRAVEL_BOOKING,
  description: "trip",
  rootAgentId: AGENT_IDS.TRAVEL,
  constraints: { destination: "Singapore", budgetUsd: 700, validFrom: "2026-10-12T00:00:00.000Z", validUntil: "2026-10-20T00:00:00.000Z" },
  status: "ACTIVE",
};

function cap(fields: Partial<ContextCapability> & Pick<ContextCapability, "capabilityId" | "agentId" | "permissions">): ContextCapability {
  const base = {
    mandateId: mandate.mandateId,
    principal: mandate.principal,
    purpose: PURPOSES.TRAVEL_BOOKING,
    delegationDepth: 0,
    maxDelegationDepth: 2,
    validFrom: "2026-10-12T00:00:00.000Z",
    expiresAt: "2026-10-20T00:00:00.000Z",
    ...fields,
  };
  const { status: _s, policyHash: _p, ...hashable } = base as ContextCapability;
  return { ...hashable, status: "ACTIVE", policyHash: computePolicyHash(hashable) };
}

const view = (capability: ContextCapability, chainStatus: ChainStatus = "ACTIVE"): CapabilityView => ({
  capability,
  chainStatus,
  chainPolicyHash: capability.policyHash,
});
const ctx = (lineage: CapabilityView[], now = NOW): EvaluationContext => ({ lineage, mandate, now });

const CAL: ContextPermission = {
  resource: RESOURCES.CALENDAR_AVAILABILITY,
  allowedModes: ["DERIVE"],
  allowedOperations: [OPERATIONS.AVAILABLE_WINDOW],
  delegable: true,
};
const root = cap({ capabilityId: "cap_root", agentId: AGENT_IDS.TRAVEL, permissions: getCapabilityTemplate(PURPOSES.TRAVEL_BOOKING)!.permissions });

const calendarRequest = (capabilityId: string, agentId: string): ContextRequest => ({
  requestId: "r",
  mandateId: mandate.mandateId,
  capabilityId,
  agentId,
  purpose: PURPOSES.TRAVEL_BOOKING,
  resource: RESOURCES.CALENDAR_AVAILABILITY,
  operation: OPERATIONS.AVAILABLE_WINDOW,
  parameters: availabilityAsk.parameters,
  timestamp: NOW.toISOString(),
});

const propose = (overrides: Record<string, unknown> = {}) => ({
  mandateId: mandate.mandateId,
  parentAgentId: AGENT_IDS.TRAVEL,
  childAgentId: AGENT_IDS.HOTEL,
  purpose: PURPOSES.TRAVEL_BOOKING,
  permissions: [{ ...CAL, delegable: false }],
  ...overrides,
});

// ------------------------------------------------------------------- tests

describe("Delegation regression suite (D01–D10)", () => {
  it("D01 valid Travel Agent → Hotel Agent delegation (broker path)", async () => {
    const h = makeHarness();
    const m = await h.createTravelMandate();
    const res = await h.broker.delegateForSession(m.session.sessionId, {
      childAgentId: AGENT_IDS.HOTEL,
      permissions: [
        { resource: RESOURCES.CALENDAR_AVAILABILITY, allowedModes: ["DERIVE"], delegable: false },
        { resource: RESOURCES.TRAVEL_HOTEL_PREFERENCES, allowedModes: ["SELECT"], delegable: false },
      ],
    });
    expect(res).toMatchObject({ allowed: true, capability: { agentId: AGENT_IDS.HOTEL, delegationDepth: 1, parentCapabilityId: m.capability.capabilityId } });
  });

  it("D02 child asking for the passport (non-delegable) is rejected", () => {
    const verdict = validateDelegation(
      propose({ permissions: [{ resource: RESOURCES.PASSPORT_VALIDITY, allowedModes: ["DERIVE"], delegable: false }] }),
      ctx([view(root)]),
    );
    expect(verdict).toMatchObject({ allowed: false, reasonCode: "DELEGATION_NOT_ALLOWED" });
    const raw = validateDelegation(
      propose({ permissions: [{ resource: RESOURCES.PASSPORT_RAW, allowedModes: ["DERIVE"], delegable: false }] }),
      ctx([view(root)]),
    );
    expect(raw).toMatchObject({ allowed: false, reasonCode: "DELEGATION_SCOPE_ESCALATION" });
  });

  it("D03 child expiry after the parent's → rejected", () => {
    const verdict = validateDelegation(propose({ expiresAt: "2026-10-20T00:00:01.000Z" }), ctx([view(root)]));
    expect(verdict).toMatchObject({ allowed: false, reasonCode: "DELEGATION_SCOPE_ESCALATION" });
  });

  it("D04 parent revoked → child effectively inactive", () => {
    const child = cap({ capabilityId: "cap_child", agentId: AGENT_IDS.HOTEL, permissions: [CAL], parentCapabilityId: root.capabilityId, delegationDepth: 1 });
    const verdict = evaluateRequest(calendarRequest(child.capabilityId, AGENT_IDS.HOTEL), ctx([view(child), view(root, "REVOKED")]));
    expect(verdict).toMatchObject({ allowed: false, reasonCode: "CAPABILITY_REVOKED" });
  });

  it("D05 parent expired → child effectively inactive (even if the child's own record is still ACTIVE)", () => {
    const child = cap({ capabilityId: "cap_child", agentId: AGENT_IDS.HOTEL, permissions: [CAL], parentCapabilityId: root.capabilityId, delegationDepth: 1 });
    const verdict = evaluateRequest(calendarRequest(child.capabilityId, AGENT_IDS.HOTEL), ctx([view(child), view(root, "EXPIRED")]));
    expect(verdict).toMatchObject({ allowed: false, reasonCode: "CAPABILITY_EXPIRED" });
  });

  it("D06 grandchild within the max depth is valid", () => {
    const deepRoot = cap({ capabilityId: "cap_r", agentId: AGENT_IDS.TRAVEL, permissions: [CAL], maxDelegationDepth: 2 });
    const childVerdict = validateDelegation(propose({ permissions: [CAL] }), ctx([view(deepRoot)]));
    expect(childVerdict.allowed).toBe(true);
    if (!childVerdict.allowed) return;
    const child = cap({ capabilityId: "cap_c", ...childVerdict.child });
    expect(child).toMatchObject({ delegationDepth: 1, maxDelegationDepth: 2 });

    const grandVerdict = validateDelegation(
      propose({ parentAgentId: AGENT_IDS.HOTEL, childAgentId: "availability-agent", permissions: [{ ...CAL, delegable: false }] }),
      ctx([view(child), view(deepRoot)]),
    );
    expect(grandVerdict).toMatchObject({ allowed: true, child: { delegationDepth: 2, agentId: "availability-agent" } });
    if (!grandVerdict.allowed) return;
    const grandchild = cap({ capabilityId: "cap_g", ...grandVerdict.child });
    const use = evaluateRequest(calendarRequest(grandchild.capabilityId, "availability-agent"), ctx([view(grandchild), view(child), view(deepRoot)]));
    expect(use).toMatchObject({ allowed: true, decision: "DERIVE" });
  });

  it("D07 grandchild beyond the max depth is rejected", () => {
    const child = cap({ capabilityId: "cap_c", agentId: AGENT_IDS.HOTEL, permissions: [CAL], parentCapabilityId: root.capabilityId, delegationDepth: 1, maxDelegationDepth: 1 });
    const verdict = validateDelegation(
      propose({ parentAgentId: AGENT_IDS.HOTEL, childAgentId: "availability-agent" }),
      ctx([view(child), view(root)]),
    );
    expect(verdict).toMatchObject({ allowed: false, reasonCode: "DELEGATION_DEPTH_EXCEEDED" });
  });

  it("D08 child asking for a broader disclosure mode → rejected", () => {
    const verdict = validateDelegation(
      propose({ permissions: [{ ...CAL, allowedModes: ["DERIVE", "SELECT"] }] }),
      ctx([view(root)]),
    );
    expect(verdict).toMatchObject({ allowed: false, reasonCode: "DELEGATION_SCOPE_ESCALATION" });
  });

  it("D09 child adding an audience the parent does not allow → rejected; narrowing is fine", () => {
    const shared: ContextPermission = { ...CAL, allowedAudience: ["calendar-ui"] };
    const parent = cap({ capabilityId: "cap_p", agentId: AGENT_IDS.TRAVEL, permissions: [shared] });
    const wider = validateDelegation(propose({ permissions: [{ ...shared, allowedAudience: ["calendar-ui", "attacker-webhook"] }] }), ctx([view(parent)]));
    expect(wider).toMatchObject({ allowed: false, reasonCode: "DELEGATION_SCOPE_ESCALATION" });
    const inherited = validateDelegation(propose({ permissions: [{ ...CAL, allowedAudience: undefined, delegable: false }] }), ctx([view(parent)]));
    expect(inherited).toMatchObject({ allowed: true, child: { permissions: [{ allowedAudience: ["calendar-ui"] }] } });
  });

  it("D10 a child never retains authority its parent lacks (runtime lineage intersection)", () => {
    // A child record that claims more than its parent (e.g. corrupted or forged
    // before integrity checks): the parent only grants SELECT on hotel prefs.
    const parent = cap({
      capabilityId: "cap_p",
      agentId: AGENT_IDS.TRAVEL,
      permissions: [{ resource: RESOURCES.TRAVEL_HOTEL_PREFERENCES, allowedModes: ["SELECT"], delegable: true }],
    });
    const child = cap({
      capabilityId: "cap_c",
      agentId: AGENT_IDS.HOTEL,
      permissions: [CAL, { resource: RESOURCES.TRAVEL_HOTEL_PREFERENCES, allowedModes: ["SELECT"], delegable: false }],
      parentCapabilityId: parent.capabilityId,
      delegationDepth: 1,
    });
    const verdict = evaluateRequest(calendarRequest(child.capabilityId, AGENT_IDS.HOTEL), ctx([view(child), view(parent)]));
    expect(verdict).toMatchObject({ allowed: false, reasonCode: "OUT_OF_SCOPE" });
  });

  it("D10b broker path: after the parent is revoked, the child's previously valid request fails", async () => {
    const h = makeHarness();
    const m = await h.createTravelMandate();
    const res = await h.broker.delegateForSession(m.session.sessionId, {
      childAgentId: AGENT_IDS.HOTEL,
      permissions: [{ resource: RESOURCES.CALENDAR_AVAILABILITY, allowedModes: ["DERIVE"], delegable: false }],
    });
    if (!res.allowed) throw new Error("delegation failed");
    expect((await h.broker.requestContextForSession(res.childSession.sessionId, availabilityAsk)).allowed).toBe(true);
    await h.broker.revokeCapability(m.capability.capabilityId);
    const after = await h.broker.requestContextForSession(res.childSession.sessionId, availabilityAsk);
    expect(after).toMatchObject({ allowed: false, reasonCode: "CAPABILITY_REVOKED" });
  });
});
