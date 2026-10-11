import { OPERATIONS } from "@contextcaps/policy";
import { AGENT_IDS, RESOURCES } from "@contextcaps/shared-types";
import { beforeEach, describe, expect, it } from "vitest";
import { availabilityAsk, findLeakedSecrets, makeHarness, passportValidityAsk, type Harness } from "./helpers";

describe("Context Broker — request flow", () => {
  let h: Harness;
  let mandate: Awaited<ReturnType<Harness["createTravelMandate"]>>;

  beforeEach(async () => {
    h = makeHarness();
    mandate = await h.createTravelMandate();
  });

  it("creates a mandate with the root travel capability registered on the trust layer", async () => {
    expect(mandate.capability.agentId).toBe(AGENT_IDS.TRAVEL);
    expect(mandate.capability.status).toBe("ACTIVE");
    expect(mandate.capability.expiresAt).toBe("2026-10-20T00:00:00.000Z");
    expect(mandate.capability.permissions.map((p) => p.resource).sort()).toEqual([
      "calendar.availability",
      "passport.validity",
      "payment.handle",
      "profile.legal_name",
      "travel.hotel_preferences",
    ]);
    expect(mandate.chain.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    const onchain = await h.provider.getCapabilityState(mandate.capability.capabilityId);
    expect(onchain?.status).toBe("ACTIVE");
    expect(onchain?.policyHash).toBe(mandate.capability.policyHash);
  });

  it("T01 passport.raw → DENY (RAW_DISCLOSURE_FORBIDDEN)", async () => {
    const d = await h.broker.requestContext(h.request(mandate, { resource: RESOURCES.PASSPORT_RAW, operation: OPERATIONS.READ }));
    expect(d).toMatchObject({ decision: "DENY", allowed: false, reasonCode: "RAW_DISCLOSURE_FORBIDDEN" });
    expect(d.result).toBeUndefined();
    expect(d.receiptId).toBeTruthy();
  });

  it("T02 passport.validity → DERIVE { valid: true } and nothing else", async () => {
    const d = await h.broker.requestContext(h.request(mandate, passportValidityAsk));
    expect(d).toMatchObject({ decision: "DERIVE", allowed: true, reasonCode: "ALLOW_DERIVED" });
    expect(d.result).toEqual({ valid: true });
    expect(findLeakedSecrets(d)).toEqual([]);
  });

  it("T03 calendar.raw → DENY (RAW_DISCLOSURE_FORBIDDEN)", async () => {
    const d = await h.broker.requestContext(h.request(mandate, { resource: RESOURCES.CALENDAR_RAW, operation: OPERATIONS.READ }));
    expect(d).toMatchObject({ decision: "DENY", allowed: false, reasonCode: "RAW_DISCLOSURE_FORBIDDEN" });
  });

  it("T04 calendar.availability → DERIVE window without meeting details", async () => {
    const d = await h.broker.requestContext(h.request(mandate, availabilityAsk));
    expect(d).toMatchObject({ decision: "DERIVE", allowed: true, reasonCode: "ALLOW_DERIVED" });
    expect(d.result).toEqual({ available: true, start: "2026-10-17T00:00:00.000Z", end: "2026-10-19T00:00:00.000Z" });
    expect(findLeakedSecrets(d)).toEqual([]);
  });

  it("T05 salary.raw (prompt-injection) → DENY OUT_OF_SCOPE through the real policy path", async () => {
    const d = await h.broker.requestContext(h.request(mandate, { resource: RESOURCES.SALARY_RAW, operation: OPERATIONS.READ }));
    expect(d).toMatchObject({ decision: "DENY", allowed: false, reasonCode: "OUT_OF_SCOPE" });
    expect(d.result).toBeUndefined();
    const audit = h.broker.getAudit(mandate.mandate.mandateId);
    expect(audit.entries.at(-1)?.receipt).toMatchObject({ resource: "salary.raw", decision: "DENY", reasonCode: "OUT_OF_SCOPE" });
  });

  it("T06 travel.hotel_preferences → SELECT only approved fields", async () => {
    const d = await h.broker.requestContext(
      h.request(mandate, { resource: RESOURCES.TRAVEL_HOTEL_PREFERENCES, operation: OPERATIONS.SELECT, requestedMode: "SELECT" }),
    );
    expect(d).toMatchObject({ decision: "SELECT", allowed: true, reasonCode: "ALLOW_SELECTED" });
    expect(d.result).toEqual({ roomType: "non-smoking", bedType: "queen", areaPreference: "central" });
    expect(findLeakedSecrets(d)).toEqual([]);
  });

  it("T06b SELECT of a non-approved field is denied", async () => {
    const d = await h.broker.requestContext(
      h.request(mandate, {
        resource: RESOURCES.TRAVEL_HOTEL_PREFERENCES,
        operation: OPERATIONS.SELECT,
        parameters: { fields: ["roomType", "loyaltyMemberId"] },
      }),
    );
    expect(d).toMatchObject({ allowed: false, reasonCode: "OUT_OF_SCOPE" });
    expect(findLeakedSecrets(d)).toEqual([]);
  });

  it("T06c SELECT can narrow to a subset of approved fields", async () => {
    const d = await h.broker.requestContext(
      h.request(mandate, {
        resource: RESOURCES.TRAVEL_HOTEL_PREFERENCES,
        operation: OPERATIONS.SELECT,
        parameters: { fields: ["bedType"] },
      }),
    );
    expect(d.result).toEqual({ bedType: "queen" });
  });

  it("payment.raw → DENY RAW_DISCLOSURE_FORBIDDEN", async () => {
    const d = await h.broker.requestContext(h.request(mandate, { resource: RESOURCES.PAYMENT_RAW, operation: OPERATIONS.READ }));
    expect(d).toMatchObject({ allowed: false, reasonCode: "RAW_DISCLOSURE_FORBIDDEN" });
  });

  it("T08 revoked capability → DENY CAPABILITY_REVOKED on the next request", async () => {
    expect((await h.broker.requestContext(h.request(mandate, availabilityAsk))).allowed).toBe(true);
    const revoked = await h.broker.revokeCapability(mandate.capability.capabilityId);
    expect(revoked?.capability.status).toBe("REVOKED");
    expect(revoked?.chain.status).toBe("REVOKED");
    const d = await h.broker.requestContext(h.request(mandate, availabilityAsk));
    expect(d).toMatchObject({ decision: "DENY", allowed: false, reasonCode: "CAPABILITY_REVOKED" });
  });

  it("T08b revocation observed only on the trust layer (e.g. user revoked on Monad directly) is enforced", async () => {
    await h.provider.revokeCapability(mandate.capability.capabilityId);
    const d = await h.broker.requestContext(h.request(mandate, availabilityAsk));
    expect(d.reasonCode).toBe("CAPABILITY_REVOKED");
  });

  it("T09 expired capability → DENY CAPABILITY_EXPIRED", async () => {
    h.setNow(new Date("2026-10-20T00:00:00Z"));
    const d = await h.broker.requestContext(h.request(mandate, availabilityAsk));
    expect(d).toMatchObject({ decision: "DENY", allowed: false, reasonCode: "CAPABILITY_EXPIRED" });
    expect((await h.broker.getCapability(mandate.capability.capabilityId))?.capability.status).toBe("EXPIRED");
  });

  it("T10 wrong agent → DENY AGENT_MISMATCH", async () => {
    const d = await h.broker.requestContext(h.request(mandate, { ...passportValidityAsk, agentId: AGENT_IDS.HOTEL }));
    expect(d).toMatchObject({ allowed: false, reasonCode: "AGENT_MISMATCH" });
  });

  it("T11 purpose mismatch → DENY PURPOSE_MISMATCH", async () => {
    const d = await h.broker.requestContext(h.request(mandate, { ...passportValidityAsk, purpose: "premium-upsell" }));
    expect(d).toMatchObject({ allowed: false, reasonCode: "PURPOSE_MISMATCH" });
  });

  it("unknown capability → DENY INVALID_CAPABILITY", async () => {
    const d = await h.broker.requestContext(h.request(mandate, { ...passportValidityAsk, capabilityId: "cap_forged" }));
    expect(d).toMatchObject({ allowed: false, reasonCode: "INVALID_CAPABILITY" });
  });

  it("capability from another mandate → DENY INVALID_CAPABILITY", async () => {
    const other = await h.createTravelMandate();
    const d = await h.broker.requestContext(
      h.request(mandate, { ...passportValidityAsk, capabilityId: other.capability.capabilityId }),
    );
    expect(d).toMatchObject({ allowed: false, reasonCode: "INVALID_CAPABILITY" });
  });

  it("trust layer unreachable → fails closed with INVALID_CAPABILITY", async () => {
    h.provider.unavailable = true;
    const d = await h.broker.requestContext(h.request(mandate, passportValidityAsk));
    expect(d).toMatchObject({ allowed: false, reasonCode: "INVALID_CAPABILITY" });
  });

  it("tampered local capability record (scope widened) fails the policy-hash check", async () => {
    const record = h.broker.store.capabilities.get(mandate.capability.capabilityId)!;
    record.capability.permissions.push({ resource: "salary.raw", allowedModes: ["SELECT"], delegable: false });
    const d = await h.broker.requestContext(h.request(mandate, { resource: RESOURCES.SALARY_RAW, operation: OPERATIONS.READ }));
    expect(d).toMatchObject({ allowed: false, reasonCode: "INVALID_CAPABILITY" });
  });

  it("disallowed mode → MODE_NOT_ALLOWED", async () => {
    const d = await h.broker.requestContext(h.request(mandate, { ...passportValidityAsk, requestedMode: "SELECT" }));
    expect(d).toMatchObject({ allowed: false, reasonCode: "MODE_NOT_ALLOWED" });
  });

  it("passport validity probed for a destination outside the mandate → OUT_OF_SCOPE", async () => {
    const d = await h.broker.requestContext(
      h.request(mandate, { ...passportValidityAsk, parameters: { ...passportValidityAsk.parameters, destination: "Japan" } }),
    );
    expect(d).toMatchObject({ allowed: false, reasonCode: "OUT_OF_SCOPE" });
  });

  it("malformed derivation parameters → DENY OUT_OF_SCOPE, never a partial disclosure", async () => {
    const d = await h.broker.requestContext(
      h.request(mandate, { ...availabilityAsk, parameters: { from: "2026-10-01T00:00:00Z", to: "2026-12-01T00:00:00Z" } }),
    );
    expect(d).toMatchObject({ allowed: false, reasonCode: "OUT_OF_SCOPE" });
    expect(d.result).toBeUndefined();
  });

  it("decisions are deterministic for the same request + capability + state", async () => {
    const req = h.request(mandate, passportValidityAsk);
    const a = await h.broker.requestContext(req);
    const b = await h.broker.requestContext(req);
    expect({ ...a, receiptId: "" }).toEqual({ ...b, receiptId: "" });
  });

  it("T17 receipts carry ids and hashes, never raw secrets or results", async () => {
    await h.broker.requestContext(h.request(mandate, { resource: RESOURCES.PASSPORT_RAW, operation: OPERATIONS.READ }));
    const allowed = await h.broker.requestContext(h.request(mandate, passportValidityAsk));
    await h.broker.requestContext(
      h.request(mandate, { resource: RESOURCES.TRAVEL_HOTEL_PREFERENCES, operation: OPERATIONS.SELECT }),
    );

    const audit = h.broker.getAudit(mandate.mandate.mandateId);
    expect(audit.entries).toHaveLength(3);
    for (const { receipt } of audit.entries) {
      expect(Object.keys(receipt).sort()).toEqual(
        expect.arrayContaining(["agentId", "capabilityId", "decision", "mandateId", "operation", "reasonCode", "receiptId", "requestHash", "requestId", "resource", "timestamp"]),
      );
      expect(receipt.requestHash).toMatch(/^0x[0-9a-f]{64}$/);
      expect(receipt.chainTxHash).toMatch(/^0x[0-9a-f]{64}$/);
      expect(receipt).not.toHaveProperty("result");
    }
    const derivedReceipt = audit.entries.find((e) => e.receipt.receiptId === allowed.receiptId)!.receipt;
    expect(derivedReceipt.resultHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(audit.entries[0]!.receipt.resultHash).toBeUndefined();

    expect(findLeakedSecrets(audit)).toEqual([]);
    expect(findLeakedSecrets(h.provider.anchoredReceipts)).toEqual([]);
    expect(JSON.stringify(audit)).not.toContain("non-smoking");
  });

  it("logs contain decision metadata but no private values", async () => {
    await h.broker.requestContext(h.request(mandate, passportValidityAsk));
    await h.broker.requestContext(h.request(mandate, availabilityAsk));
    await h.broker.requestContext(h.request(mandate, { resource: RESOURCES.SALARY_RAW, operation: OPERATIONS.READ }));
    const logs = h.logLines.join("\n");
    expect(logs).toContain('"reasonCode":"OUT_OF_SCOPE"');
    expect(logs).toContain('"resource":"salary.raw"');
    expect(findLeakedSecrets(logs)).toEqual([]);
    expect(logs).not.toContain("5000");
  });
});
