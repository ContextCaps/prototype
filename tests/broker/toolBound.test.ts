import { BOOKING_TOOL_ID } from "@contextcaps/policy";
import { AGENT_IDS, RESOURCES, type ToolBoundHandle, type ToolInvocationRequest } from "@contextcaps/shared-types";
import { beforeEach, describe, expect, it } from "vitest";
import { findLeakedSecrets, makeHarness, toolBoundAsk, type Harness } from "./helpers";

describe("TOOL_BOUND checkout", () => {
  let h: Harness;
  let mandate: Awaited<ReturnType<Harness["createTravelMandate"]>>;

  async function issueHandle(resource: string, overrides = {}) {
    const d = await h.broker.requestContext(h.request(mandate, { ...toolBoundAsk(resource), ...overrides }));
    return d;
  }

  async function handles() {
    const identity = await issueHandle(RESOURCES.PROFILE_LEGAL_NAME);
    const payment = await issueHandle(RESOURCES.PAYMENT_HANDLE);
    return {
      identityHandle: (identity.result as ToolBoundHandle).handle,
      paymentHandle: (payment.result as ToolBoundHandle).handle,
    };
  }

  function invocation(args: Record<string, unknown>, overrides: Partial<ToolInvocationRequest> = {}): ToolInvocationRequest {
    return {
      requestId: "req_tool_1",
      mandateId: mandate.mandate.mandateId,
      capabilityId: mandate.capability.capabilityId,
      agentId: AGENT_IDS.TRAVEL,
      purpose: mandate.mandate.purpose,
      arguments: { offerId: "SG-HTL-MRNA-02", checkIn: "2026-10-17", checkOut: "2026-10-18", amountUsd: 189, ...args },
      ...overrides,
    };
  }

  beforeEach(async () => {
    h = makeHarness();
    mandate = await h.createTravelMandate();
  });

  it("issues an opaque handle (not the secret) for payment.handle", async () => {
    const d = await issueHandle(RESOURCES.PAYMENT_HANDLE);
    expect(d).toMatchObject({ decision: "TOOL_BOUND", allowed: true, reasonCode: "ALLOW_TOOL_BOUND" });
    const handle = d.result as ToolBoundHandle;
    expect(handle.handle).toMatch(/^tbh_[0-9a-f]{32}$/);
    expect(handle.audience).toBe(BOOKING_TOOL_ID);
    expect(findLeakedSecrets(d)).toEqual([]);
  });

  it("T07 booking succeeds; the connector receives the secret; the agent-visible payload never does", async () => {
    const h1 = await handles();
    const result = await h.broker.invokeTool(BOOKING_TOOL_ID, invocation(h1));
    expect(result).toMatchObject({ allowed: true, decision: "TOOL_BOUND", reasonCode: "ALLOW_TOOL_BOUND" });
    expect(result.result).toMatchObject({ bookingStatus: "CONFIRMED", reference: "CC-DEMO-001" });
    expect(findLeakedSecrets(result)).toEqual([]);

    // The approved connector did receive the real credentials.
    expect(h.booking.bookings).toHaveLength(1);
    expect(h.booking.bookings[0]).toMatchObject({ paymentToken: "secret-demo-token", guestName: "Alex Morgan" });

    // Receipts and logs stay clean.
    expect(result.receiptIds).toHaveLength(2);
    expect(findLeakedSecrets(h.broker.getAudit(mandate.mandate.mandateId))).toEqual([]);
    expect(findLeakedSecrets(h.logLines.join("\n"))).toEqual([]);
  });

  it("TOOL_BOUND without an approved audience → AUDIENCE_NOT_ALLOWED", async () => {
    const missing = await issueHandle(RESOURCES.PAYMENT_HANDLE, { audience: undefined });
    expect(missing).toMatchObject({ allowed: false, reasonCode: "AUDIENCE_NOT_ALLOWED" });
    const wrong = await issueHandle(RESOURCES.PAYMENT_HANDLE, { audience: "attacker-webhook" });
    expect(wrong).toMatchObject({ allowed: false, reasonCode: "AUDIENCE_NOT_ALLOWED" });
  });

  it("unknown tool → TOOL_NOT_ALLOWED", async () => {
    const result = await h.broker.invokeTool("exfil-tool", invocation(await handles()));
    expect(result).toMatchObject({ allowed: false, reasonCode: "TOOL_NOT_ALLOWED" });
  });

  it("handles are single-use", async () => {
    const h1 = await handles();
    expect((await h.broker.invokeTool(BOOKING_TOOL_ID, invocation(h1))).allowed).toBe(true);
    const replay = await h.broker.invokeTool(BOOKING_TOOL_ID, invocation(h1, { requestId: "req_tool_2" }));
    expect(replay).toMatchObject({ allowed: false, reasonCode: "TOOL_NOT_ALLOWED" });
    expect(h.booking.bookings).toHaveLength(1);
  });

  it("swapped handles (payment handle in the identity slot) → TOOL_NOT_ALLOWED", async () => {
    const h1 = await handles();
    const result = await h.broker.invokeTool(
      BOOKING_TOOL_ID,
      invocation({ identityHandle: h1.paymentHandle, paymentHandle: h1.identityHandle }),
    );
    expect(result).toMatchObject({ allowed: false, reasonCode: "TOOL_NOT_ALLOWED" });
  });

  it("forged handle → TOOL_NOT_ALLOWED", async () => {
    const h1 = await handles();
    const result = await h.broker.invokeTool(BOOKING_TOOL_ID, invocation({ ...h1, paymentHandle: "tbh_" + "0".repeat(32) }));
    expect(result).toMatchObject({ allowed: false, reasonCode: "TOOL_NOT_ALLOWED" });
  });

  it("another agent cannot spend the travel agent's handles", async () => {
    const h1 = await handles();
    const result = await h.broker.invokeTool(BOOKING_TOOL_ID, invocation(h1, { agentId: AGENT_IDS.HOTEL }));
    expect(result).toMatchObject({ allowed: false, reasonCode: "AGENT_MISMATCH" });
    expect(h.booking.bookings).toHaveLength(0);
  });

  it("charge above the mandate budget → OUT_OF_SCOPE", async () => {
    const result = await h.broker.invokeTool(BOOKING_TOOL_ID, invocation({ ...(await handles()), amountUsd: 701 }));
    expect(result).toMatchObject({ allowed: false, reasonCode: "OUT_OF_SCOPE" });
    expect(h.booking.bookings).toHaveLength(0);
  });

  it("revocation between handle issuance and checkout blocks the booking", async () => {
    const h1 = await handles();
    await h.broker.revokeCapability(mandate.capability.capabilityId);
    const result = await h.broker.invokeTool(BOOKING_TOOL_ID, invocation(h1));
    expect(result).toMatchObject({ allowed: false, reasonCode: "CAPABILITY_REVOKED" });
    expect(h.booking.bookings).toHaveLength(0);
  });

  it("expired handle → TOOL_NOT_ALLOWED", async () => {
    const h1 = await handles();
    h.setNow(new Date(h.clock().getTime() + 16 * 60 * 1000));
    const result = await h.broker.invokeTool(BOOKING_TOOL_ID, invocation(h1));
    expect(result).toMatchObject({ allowed: false, reasonCode: "TOOL_NOT_ALLOWED" });
  });
});
