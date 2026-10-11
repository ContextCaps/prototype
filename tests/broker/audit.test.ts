import { BOOKING_TOOL_ID, canonicalJson, hmacHex, OPERATIONS, sha256Hex } from "@contextcaps/policy";
import { AGENT_IDS, RESOURCES, type DisclosureReceipt, type ToolBoundHandle } from "@contextcaps/shared-types";
import { describe, expect, it } from "vitest";
import { availabilityAsk, findLeakedSecrets, makeHarness, passportValidityAsk, toolBoundAsk } from "./helpers";

const RECEIPT_FIELDS = [
  "requestId",
  "mandateId",
  "capabilityId",
  "agentId",
  "resource",
  "operation",
  "decision",
  "reasonCode",
  "requestHash",
  "timestamp",
] as const;

/** Drives every kind of broker decision once and returns the audit. */
async function exerciseAllDecisions() {
  const h = makeHarness();
  const m = await h.createTravelMandate();
  const s = m.session.sessionId;
  const results: Record<string, { receiptId: string; result?: unknown }> = {};

  results.deny = await h.broker.requestContextForSession(s, { resource: RESOURCES.PASSPORT_RAW, operation: OPERATIONS.READ });
  results.derive = await h.broker.requestContextForSession(s, passportValidityAsk);
  results.select = await h.broker.requestContextForSession(s, { resource: RESOURCES.TRAVEL_HOTEL_PREFERENCES, operation: OPERATIONS.SELECT });
  const id = await h.broker.requestContextForSession(s, toolBoundAsk(RESOURCES.PROFILE_LEGAL_NAME));
  const pay = await h.broker.requestContextForSession(s, toolBoundAsk(RESOURCES.PAYMENT_HANDLE));
  results.toolBoundHandle = pay;
  results.impersonation = await h.broker.requestContextForSession(s, { ...availabilityAsk, agentId: AGENT_IDS.HOTEL });

  const booking = await h.broker.invokeToolForSession(s, BOOKING_TOOL_ID, {
    arguments: {
      offerId: "SG-HTL-MRNA-02",
      checkIn: "2026-10-17",
      checkOut: "2026-10-18",
      amountUsd: 189,
      identityHandle: (id.result as ToolBoundHandle).handle,
      paymentHandle: (pay.result as ToolBoundHandle).handle,
    },
  });

  await h.broker.delegateForSession(s, {
    childAgentId: AGENT_IDS.HOTEL,
    permissions: [{ resource: RESOURCES.PASSPORT_VALIDITY, allowedModes: ["DERIVE"], delegable: false }],
  });
  await h.broker.delegateForSession(s, {
    childAgentId: AGENT_IDS.HOTEL,
    permissions: [{ resource: RESOURCES.CALENDAR_AVAILABILITY, allowedModes: ["DERIVE"], delegable: false }],
  });

  await h.broker.revokeCapability(m.capability.capabilityId);
  results.revoked = await h.broker.requestContextForSession(s, availabilityAsk);

  return { h, m, results, booking, audit: h.broker.getAudit(m.mandate.mandateId) };
}

describe("Receipts and audit", () => {
  it("every disclosure decision type produces a complete receipt", async () => {
    const { results, booking, audit } = await exerciseAllDecisions();
    const byId = new Map(audit.entries.map((e) => [e.receipt.receiptId, e]));
    const expectations: Array<[string, string, string]> = [
      ["deny", "DENY", "RAW_DISCLOSURE_FORBIDDEN"],
      ["derive", "DERIVE", "ALLOW_DERIVED"],
      ["select", "SELECT", "ALLOW_SELECTED"],
      ["toolBoundHandle", "TOOL_BOUND", "ALLOW_TOOL_BOUND"],
      ["impersonation", "DENY", "AGENT_MISMATCH"],
      ["revoked", "DENY", "CAPABILITY_REVOKED"],
    ];
    for (const [key, decision, reasonCode] of expectations) {
      const entry = byId.get(results[key]!.receiptId);
      expect(entry, key).toBeDefined();
      expect(entry!.receipt, key).toMatchObject({ decision, reasonCode });
      for (const field of RECEIPT_FIELDS) expect(entry!.receipt[field], `${key}.${field}`).toBeTruthy();
      expect(entry!.receipt.chainTxHash, key).toMatch(/^0x[0-9a-f]{64}$/);
    }
    // Tool injection: one receipt per injected credential.
    const injected = booking.receiptIds.map((r) => byId.get(r)!.receipt);
    expect(injected.map((r) => [r.resource, r.operation, r.decision])).toEqual([
      ["profile.legal_name", `inject:${BOOKING_TOOL_ID}`, "TOOL_BOUND"],
      ["payment.handle", `inject:${BOOKING_TOOL_ID}`, "TOOL_BOUND"],
    ]);
  });

  it("allowed results carry a resultHash; denials do not", async () => {
    const { results, audit } = await exerciseAllDecisions();
    const receipt = (key: string) => audit.entries.find((e) => e.receipt.receiptId === results[key]!.receiptId)!.receipt;
    for (const key of ["derive", "select", "toolBoundHandle"]) expect(receipt(key).resultHash, key).toMatch(/^0x[0-9a-f]{64}$/);
    for (const key of ["deny", "impersonation", "revoked"]) expect(receipt(key).resultHash, key).toBeUndefined();
  });

  it("resultHash is a keyed commitment: not plain SHA-256, verifiable only with the receipt key", async () => {
    const { results, audit } = await exerciseAllDecisions();
    const derived = audit.entries.find((e) => e.receipt.receiptId === results.derive!.receiptId)!.receipt;
    const preimage = canonicalJson(results.derive!.result);
    expect(derived.resultHash).not.toBe(sha256Hex(preimage)); // cannot be brute-forced from {"valid":true}
    expect(derived.resultHash).toBe(hmacHex("test-receipt-key", preimage)); // the key holder can verify
    expect(derived.resultHash).not.toBe(hmacHex("wrong-key", preimage));
  });

  it("delegation attempts and successes are recorded as lifecycle events with a request hash", async () => {
    const { audit } = await exerciseAllDecisions();
    const types = audit.lifecycle.map((e) => e.type);
    expect(types).toEqual(["MANDATE_CREATED", "DELEGATION_REJECTED", "DELEGATION_CREATED", "CAPABILITY_REVOKED"]);
    const rejected = audit.lifecycle[1]!;
    const created = audit.lifecycle[2]!;
    expect(rejected).toMatchObject({ reasonCode: "DELEGATION_NOT_ALLOWED", agentId: AGENT_IDS.HOTEL });
    expect(rejected.requestHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(created.requestHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(created.delegationId).toBe(audit.delegations[0]!.delegationId);
    expect(created.chainTxHash).toMatch(/^0x/);
    for (const e of audit.lifecycle) expect(e.eventId).toMatch(/^evt_/);
  });

  it("anchored payloads hold only ids and hashes — no raw values, results or secrets", async () => {
    const { h, audit } = await exerciseAllDecisions();
    const anchored = JSON.stringify(h.provider.anchoredReceipts);
    expect(findLeakedSecrets(anchored)).toEqual([]);
    for (const leak of ["non-smoking", "queen", "central", "valid", "tbh_", "demo-pay", "available"]) {
      expect(anchored, leak).not.toContain(leak);
    }
    for (const anchor of h.provider.anchoredReceipts) {
      expect(Object.keys(anchor).sort()).toEqual(["capabilityId", "receiptId", "requestHash", "resultHash"].sort());
    }
    expect(h.provider.anchoredReceipts).toHaveLength(audit.entries.length);
  });

  it("receipts never include results, parameters or handles", async () => {
    const { audit } = await exerciseAllDecisions();
    for (const { receipt } of audit.entries) {
      const allowedKeys: Array<keyof DisclosureReceipt> = [...RECEIPT_FIELDS, "receiptId", "resultHash", "chainTxHash"];
      expect(Object.keys(receipt).every((k) => (allowedKeys as string[]).includes(k)), receipt.receiptId).toBe(true);
    }
    const serialized = JSON.stringify(audit);
    expect(serialized).not.toMatch(/tbh_[0-9a-f]{32}/);
    expect(serialized).not.toContain("2026-10-17"); // request parameters are hashed, not stored
    expect(findLeakedSecrets(serialized)).toEqual([]);
  });
});
