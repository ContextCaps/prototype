import { OPERATIONS } from "@contextcaps/policy";
import { AGENT_IDS, RESOURCES, type ContextPermission, type CreateDelegationRequest } from "@contextcaps/shared-types";
import { beforeEach, describe, expect, it } from "vitest";
import { availabilityAsk, makeHarness, passportValidityAsk, type Harness } from "./helpers";

const HOTEL_PERMISSIONS: ContextPermission[] = [
  { resource: RESOURCES.CALENDAR_AVAILABILITY, allowedModes: ["DERIVE"], delegable: false },
  { resource: RESOURCES.TRAVEL_HOTEL_PREFERENCES, allowedModes: ["SELECT"], delegable: false },
];

describe("Delegation attenuation", () => {
  let h: Harness;
  let mandate: Awaited<ReturnType<Harness["createTravelMandate"]>>;

  const proposal = (overrides: Partial<CreateDelegationRequest> = {}): CreateDelegationRequest => ({
    mandateId: mandate.mandate.mandateId,
    parentCapabilityId: mandate.capability.capabilityId,
    parentAgentId: AGENT_IDS.TRAVEL,
    childAgentId: AGENT_IDS.HOTEL,
    purpose: mandate.mandate.purpose,
    permissions: HOTEL_PERMISSIONS,
    ...overrides,
  });

  async function delegateHotel() {
    const result = await h.broker.delegate(proposal());
    if (!result.allowed) throw new Error(`delegation rejected: ${result.reasonCode}`);
    return result;
  }

  beforeEach(async () => {
    h = makeHarness();
    mandate = await h.createTravelMandate();
  });

  it("T13 valid reduced delegation succeeds and is registered with parent linkage", async () => {
    const result = await delegateHotel();
    const child = result.capability;
    expect(child.agentId).toBe(AGENT_IDS.HOTEL);
    expect(child.parentCapabilityId).toBe(mandate.capability.capabilityId);
    expect(child.delegationDepth).toBe(1);
    expect(child.expiresAt).toBe(mandate.capability.expiresAt);
    expect(child.permissions.map((p) => p.resource)).toEqual([RESOURCES.CALENDAR_AVAILABILITY, RESOURCES.TRAVEL_HOTEL_PREFERENCES]);
    expect(result.delegation).toMatchObject({ parentAgentId: AGENT_IDS.TRAVEL, childAgentId: AGENT_IDS.HOTEL });
    expect(h.provider.delegationLinks).toContainEqual({
      parentCapabilityId: mandate.capability.capabilityId,
      childCapabilityId: child.capabilityId,
      childAgentId: AGENT_IDS.HOTEL,
    });
    expect((await h.broker.getCapability(mandate.capability.capabilityId))?.childCapabilityIds).toEqual([child.capabilityId]);
  });

  it("Hotel Agent receives availability (DERIVE) and hotel preferences (SELECT)", async () => {
    const { capability: child } = await delegateHotel();
    const asChild = { capabilityId: child.capabilityId, agentId: AGENT_IDS.HOTEL };
    const availability = await h.broker.requestContext(h.request(mandate, { ...availabilityAsk, ...asChild }));
    expect(availability).toMatchObject({ allowed: true, decision: "DERIVE" });
    const prefs = await h.broker.requestContext(
      h.request(mandate, { resource: RESOURCES.TRAVEL_HOTEL_PREFERENCES, operation: OPERATIONS.SELECT, ...asChild }),
    );
    expect(prefs).toMatchObject({ allowed: true, decision: "SELECT" });
  });

  it("T12 Hotel Agent requesting passport → DENY", async () => {
    const { capability: child } = await delegateHotel();
    const asChild = { capabilityId: child.capabilityId, agentId: AGENT_IDS.HOTEL };
    const validity = await h.broker.requestContext(h.request(mandate, { ...passportValidityAsk, ...asChild }));
    expect(validity).toMatchObject({ decision: "DENY", allowed: false, reasonCode: "OUT_OF_SCOPE" });
    const raw = await h.broker.requestContext(
      h.request(mandate, { resource: RESOURCES.PASSPORT_RAW, operation: OPERATIONS.READ, ...asChild }),
    );
    expect(raw).toMatchObject({ allowed: false, reasonCode: "OUT_OF_SCOPE" });
  });

  it("Hotel Agent cannot obtain payment, identity or salary", async () => {
    const { capability: child } = await delegateHotel();
    const asChild = { capabilityId: child.capabilityId, agentId: AGENT_IDS.HOTEL };
    for (const resource of [RESOURCES.PAYMENT_HANDLE, RESOURCES.PROFILE_LEGAL_NAME, RESOURCES.SALARY_RAW]) {
      const d = await h.broker.requestContext(h.request(mandate, { resource, operation: OPERATIONS.ISSUE_HANDLE, ...asChild }));
      expect(d.allowed, resource).toBe(false);
    }
  });

  it("Hotel Agent cannot use the parent's capability (agent binding)", async () => {
    await delegateHotel();
    const d = await h.broker.requestContext(h.request(mandate, { ...passportValidityAsk, agentId: AGENT_IDS.HOTEL }));
    expect(d.reasonCode).toBe("AGENT_MISMATCH");
  });

  it("T14 child requesting a resource the parent does not hold → DELEGATION_SCOPE_ESCALATION", async () => {
    const result = await h.broker.delegate(
      proposal({ permissions: [{ resource: RESOURCES.SALARY_RAW, allowedModes: ["SELECT"], delegable: false }] }),
    );
    expect(result).toMatchObject({ allowed: false, reasonCode: "DELEGATION_SCOPE_ESCALATION" });
  });

  it("T14b child requesting a broader mode than the parent → DELEGATION_SCOPE_ESCALATION", async () => {
    const result = await h.broker.delegate(
      proposal({ permissions: [{ resource: RESOURCES.CALENDAR_AVAILABILITY, allowedModes: ["DERIVE", "SELECT"], delegable: false }] }),
    );
    expect(result).toMatchObject({ allowed: false, reasonCode: "DELEGATION_SCOPE_ESCALATION" });
  });

  it("T14c child requesting operations outside the parent's → DELEGATION_SCOPE_ESCALATION", async () => {
    const result = await h.broker.delegate(
      proposal({
        permissions: [
          { resource: RESOURCES.CALENDAR_AVAILABILITY, allowedModes: ["DERIVE"], allowedOperations: ["read"], delegable: false },
        ],
      }),
    );
    expect(result).toMatchObject({ allowed: false, reasonCode: "DELEGATION_SCOPE_ESCALATION" });
  });

  it("T15 child expiry later than the parent's → rejected", async () => {
    const result = await h.broker.delegate(proposal({ expiresAt: "2026-10-21T00:00:00Z" }));
    expect(result).toMatchObject({ allowed: false, reasonCode: "DELEGATION_SCOPE_ESCALATION" });
  });

  it("child expiry earlier than the parent's is allowed and enforced", async () => {
    const result = await h.broker.delegate(proposal({ expiresAt: "2026-10-13T00:00:00Z" }));
    expect(result.allowed).toBe(true);
    if (!result.allowed) return;
    h.setNow(new Date("2026-10-13T00:00:01Z"));
    const d = await h.broker.requestContext(
      h.request(mandate, { ...availabilityAsk, capabilityId: result.capability.capabilityId, agentId: AGENT_IDS.HOTEL }),
    );
    expect(d.reasonCode).toBe("CAPABILITY_EXPIRED");
  });

  it("T16 non-delegable resource (passport.validity) → DELEGATION_NOT_ALLOWED", async () => {
    const result = await h.broker.delegate(
      proposal({ permissions: [{ resource: RESOURCES.PASSPORT_VALIDITY, allowedModes: ["DERIVE"], delegable: false }] }),
    );
    expect(result).toMatchObject({ allowed: false, reasonCode: "DELEGATION_NOT_ALLOWED" });
  });

  it("T16b payment handle is non-delegable", async () => {
    const result = await h.broker.delegate(
      proposal({ permissions: [{ resource: RESOURCES.PAYMENT_HANDLE, allowedModes: ["TOOL_BOUND"], delegable: false }] }),
    );
    expect(result).toMatchObject({ allowed: false, reasonCode: "DELEGATION_NOT_ALLOWED" });
  });

  it("child cannot re-delegate beyond the depth allowance → DELEGATION_DEPTH_EXCEEDED", async () => {
    const { capability: child } = await delegateHotel();
    const result = await h.broker.delegate(
      proposal({
        parentCapabilityId: child.capabilityId,
        parentAgentId: AGENT_IDS.HOTEL,
        childAgentId: "rogue-agent",
        permissions: [{ resource: RESOURCES.CALENDAR_AVAILABILITY, allowedModes: ["DERIVE"], delegable: false }],
      }),
    );
    expect(result).toMatchObject({ allowed: false, reasonCode: "DELEGATION_DEPTH_EXCEEDED" });
  });

  it("requesting a larger depth allowance than the parent → DELEGATION_DEPTH_EXCEEDED", async () => {
    const result = await h.broker.delegate(proposal({ maxDelegationDepth: 3 }));
    expect(result).toMatchObject({ allowed: false, reasonCode: "DELEGATION_DEPTH_EXCEEDED" });
  });

  it("only the parent capability's agent may delegate (AGENT_MISMATCH)", async () => {
    const result = await h.broker.delegate(proposal({ parentAgentId: AGENT_IDS.HOTEL }));
    expect(result).toMatchObject({ allowed: false, reasonCode: "AGENT_MISMATCH" });
  });

  it("child purpose must match the parent's (PURPOSE_MISMATCH)", async () => {
    const result = await h.broker.delegate(proposal({ purpose: "marketing" }));
    expect(result).toMatchObject({ allowed: false, reasonCode: "PURPOSE_MISMATCH" });
  });

  it("revoked parent cannot delegate", async () => {
    await h.broker.revokeCapability(mandate.capability.capabilityId);
    const result = await h.broker.delegate(proposal());
    expect(result).toMatchObject({ allowed: false, reasonCode: "CAPABILITY_REVOKED" });
  });

  it("revoking the parent cascades: the child is denied CAPABILITY_REVOKED", async () => {
    const { capability: child } = await delegateHotel();
    await h.broker.revokeCapability(mandate.capability.capabilityId);
    const d = await h.broker.requestContext(
      h.request(mandate, { ...availabilityAsk, capabilityId: child.capabilityId, agentId: AGENT_IDS.HOTEL }),
    );
    expect(d.reasonCode).toBe("CAPABILITY_REVOKED");
    expect((await h.broker.getCapability(child.capabilityId))?.capability.status).toBe("REVOKED");
  });

  it("rejected delegations are recorded in the lifecycle audit", async () => {
    await h.broker.delegate(
      proposal({ permissions: [{ resource: RESOURCES.PASSPORT_VALIDITY, allowedModes: ["DERIVE"], delegable: false }] }),
    );
    const audit = h.broker.getAudit(mandate.mandate.mandateId);
    expect(audit.lifecycle.at(-1)).toMatchObject({ type: "DELEGATION_REJECTED", reasonCode: "DELEGATION_NOT_ALLOWED" });
  });
});
