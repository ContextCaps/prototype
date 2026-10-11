import {
  computePolicyHash,
  evaluateRequest,
  getCapabilityTemplate,
  OPERATIONS,
  PURPOSES,
  type EvaluationContext,
} from "@contextcaps/policy";
import { AGENT_IDS, RESOURCES, type ContextCapability, type ContextRequest, type TaskMandate } from "@contextcaps/shared-types";
import { describe, expect, it } from "vitest";
import { NOW, TRIP } from "./helpers";

/** Pure unit tests: no broker, no vault, no chain — only the deterministic policy function. */

const mandate: TaskMandate = {
  mandateId: "mdt_1",
  principal: "0xA11CE",
  purpose: PURPOSES.TRAVEL_BOOKING,
  description: "Book my Singapore trip next weekend under $700.",
  rootAgentId: AGENT_IDS.TRAVEL,
  constraints: { budgetUsd: 700, destination: "Singapore", validFrom: "2026-10-12T00:00:00.000Z", validUntil: "2026-10-20T00:00:00.000Z" },
  status: "ACTIVE",
};

function rootCapability(): ContextCapability {
  const template = getCapabilityTemplate(PURPOSES.TRAVEL_BOOKING)!;
  const fields = {
    capabilityId: "cap_1",
    mandateId: mandate.mandateId,
    principal: mandate.principal,
    agentId: AGENT_IDS.TRAVEL,
    purpose: PURPOSES.TRAVEL_BOOKING,
    permissions: template.permissions,
    delegationDepth: 0,
    maxDelegationDepth: 1,
    validFrom: mandate.constraints.validFrom,
    expiresAt: mandate.constraints.validUntil,
  };
  return { ...fields, status: "ACTIVE", policyHash: computePolicyHash(fields) };
}

function ctx(overrides: Partial<EvaluationContext> = {}, chainStatus: EvaluationContext["lineage"][0]["chainStatus"] = "ACTIVE"): EvaluationContext {
  const capability = rootCapability();
  return {
    lineage: [{ capability, chainStatus, chainPolicyHash: capability.policyHash }],
    mandate,
    now: NOW,
    ...overrides,
  };
}

function req(overrides: Partial<ContextRequest>): ContextRequest {
  return {
    requestId: "r1",
    mandateId: "mdt_1",
    capabilityId: "cap_1",
    agentId: AGENT_IDS.TRAVEL,
    purpose: PURPOSES.TRAVEL_BOOKING,
    resource: RESOURCES.PASSPORT_VALIDITY,
    operation: OPERATIONS.VALID_FOR_TRIP,
    parameters: { ...TRIP },
    timestamp: NOW.toISOString(),
    ...overrides,
  };
}

describe("Policy engine (pure)", () => {
  it.each([
    [RESOURCES.PASSPORT_RAW, "DENY", "RAW_DISCLOSURE_FORBIDDEN"],
    [RESOURCES.CALENDAR_RAW, "DENY", "RAW_DISCLOSURE_FORBIDDEN"],
    [RESOURCES.PAYMENT_RAW, "DENY", "RAW_DISCLOSURE_FORBIDDEN"],
    [RESOURCES.SALARY_RAW, "DENY", "OUT_OF_SCOPE"],
    ["medical.raw", "DENY", "OUT_OF_SCOPE"],
  ])("raw/out-of-scope %s → %s %s", (resource, decision, reasonCode) => {
    const verdict = evaluateRequest(req({ resource, operation: OPERATIONS.READ, parameters: undefined }), ctx());
    expect(verdict).toMatchObject({ allowed: false, decision, reasonCode });
  });

  it("MVP policy table: default modes per resource", () => {
    const cases: Array<[Partial<ContextRequest>, string]> = [
      [{ resource: RESOURCES.PASSPORT_VALIDITY, operation: OPERATIONS.VALID_FOR_TRIP }, "DERIVE"],
      [
        {
          resource: RESOURCES.CALENDAR_AVAILABILITY,
          operation: OPERATIONS.AVAILABLE_WINDOW,
          parameters: { from: "2026-10-17T00:00:00Z", to: "2026-10-19T00:00:00Z" },
        },
        "DERIVE",
      ],
      [{ resource: RESOURCES.TRAVEL_HOTEL_PREFERENCES, operation: OPERATIONS.SELECT, parameters: {} }, "SELECT"],
      [{ resource: RESOURCES.PAYMENT_HANDLE, operation: OPERATIONS.ISSUE_HANDLE, audience: "demo-booking-connector", parameters: {} }, "TOOL_BOUND"],
      [{ resource: RESOURCES.PROFILE_LEGAL_NAME, operation: OPERATIONS.ISSUE_HANDLE, audience: "demo-booking-connector", parameters: {} }, "TOOL_BOUND"],
    ];
    for (const [overrides, decision] of cases) {
      expect(evaluateRequest(req(overrides), ctx()), overrides.resource).toMatchObject({ allowed: true, decision });
    }
  });

  it("revoked > expired: revocation is reported even if also expired", () => {
    const verdict = evaluateRequest(req({}), ctx({ now: new Date("2027-01-01T00:00:00Z") }, "REVOKED"));
    expect(verdict.reasonCode).toBe("CAPABILITY_REVOKED");
  });

  it("chain says EXPIRED → CAPABILITY_EXPIRED", () => {
    expect(evaluateRequest(req({}), ctx({}, "EXPIRED")).reasonCode).toBe("CAPABILITY_EXPIRED");
  });

  it("not yet valid → INVALID_CAPABILITY", () => {
    expect(evaluateRequest(req({}), ctx({ now: new Date("2026-10-11T00:00:00Z") })).reasonCode).toBe("INVALID_CAPABILITY");
  });

  it("chain policy hash mismatch → INVALID_CAPABILITY", () => {
    const c = ctx();
    c.lineage[0]!.chainPolicyHash = "0x" + "1".repeat(64);
    expect(evaluateRequest(req({}), c).reasonCode).toBe("INVALID_CAPABILITY");
  });

  it("unavailable / unregistered trust-layer state fails closed", () => {
    expect(evaluateRequest(req({}), ctx({}, "UNAVAILABLE")).reasonCode).toBe("INVALID_CAPABILITY");
    expect(evaluateRequest(req({}), ctx({}, "NOT_FOUND")).reasonCode).toBe("INVALID_CAPABILITY");
  });

  it("missing mandate → INVALID_CAPABILITY", () => {
    expect(evaluateRequest(req({}), ctx({ mandate: undefined })).reasonCode).toBe("INVALID_CAPABILITY");
  });

  it("unsupported operation → OUT_OF_SCOPE", () => {
    expect(evaluateRequest(req({ operation: "read" }), ctx()).reasonCode).toBe("OUT_OF_SCOPE");
  });

  it("requestedMode DENY is not a disclosure mode → MODE_NOT_ALLOWED", () => {
    expect(evaluateRequest(req({ requestedMode: "DENY" }), ctx()).reasonCode).toBe("MODE_NOT_ALLOWED");
  });

  it("is a pure function: identical inputs give identical verdicts", () => {
    const a = evaluateRequest(req({}), ctx());
    const b = evaluateRequest(req({}), ctx());
    expect(a).toEqual(b);
  });

  it("policy hash is stable and sensitive to scope changes", () => {
    const cap = rootCapability();
    const { policyHash, status: _status, ...fields } = cap;
    expect(computePolicyHash(fields)).toBe(policyHash);
    expect(computePolicyHash({ ...fields, permissions: fields.permissions.slice(1) })).not.toBe(policyHash);
    expect(policyHash).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
