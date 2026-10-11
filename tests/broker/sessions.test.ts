import { createBrokerApp, createLogger, MockCapabilityStateProvider, sequentialIds, type BrokerApp } from "@contextcaps/broker";
import { BOOKING_TOOL_ID, OPERATIONS } from "@contextcaps/policy";
import { AGENT_IDS, RESOURCES, type CreateMandateResponse } from "@contextcaps/shared-types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { availabilityAsk, MANDATE_VALID_UNTIL, NOW, passportValidityAsk } from "./helpers";

/** Agent identity is bound to broker-issued sessions, never to request-body fields. */
describe("Agent identity binding (sessions)", () => {
  let app: BrokerApp;
  let mandate: CreateMandateResponse;

  const call = (url: string, payload: object, headers: Record<string, string> = {}) =>
    app.server.inject({ method: "POST", url, payload, headers });
  const asSession = (sessionId: string) => ({ "x-contextcaps-session": sessionId });

  async function delegateHotel(): Promise<{ sessionId: string; capabilityId: string }> {
    const res = await call(
      "/api/v1/delegations",
      {
        childAgentId: AGENT_IDS.HOTEL,
        permissions: [
          { resource: RESOURCES.CALENDAR_AVAILABILITY, allowedModes: ["DERIVE"], delegable: false },
          { resource: RESOURCES.TRAVEL_HOTEL_PREFERENCES, allowedModes: ["SELECT"], delegable: false },
        ],
      },
      asSession(mandate.session.sessionId),
    );
    expect(res.statusCode).toBe(201);
    const body = res.json();
    return { sessionId: body.childSession.sessionId, capabilityId: body.capability.capabilityId };
  }

  beforeEach(async () => {
    const clock = () => NOW;
    app = await createBrokerApp(
      { receiptKey: "k", demoMode: true, corsOrigins: true, chainProvider: "mock" },
      { clock, ids: sequentialIds(), logger: createLogger(() => {}), provider: new MockCapabilityStateProvider(clock) },
    );
    const res = await call("/api/v1/mandates", {
      principal: "0xA11CE",
      description: "Book my Singapore trip next weekend under $700.",
      constraints: { budgetUsd: 700, destination: "Singapore", validUntil: MANDATE_VALID_UNTIL },
    });
    mandate = res.json();
  });

  afterEach(async () => {
    await app.server.close();
  });

  it("mandate creation issues an unguessable root-agent session", () => {
    expect(mandate.session).toMatchObject({
      agentId: AGENT_IDS.TRAVEL,
      mandateId: mandate.mandate.mandateId,
      capabilityId: mandate.capability.capabilityId,
      purpose: "travel-booking",
    });
    expect(mandate.session.sessionId).toMatch(/^ses_[0-9a-f]{32}$/);
  });

  it("A01 Travel Agent session → identity resolved server-side as travel-agent", async () => {
    const res = await call("/api/v1/context/request", passportValidityAsk, asSession(mandate.session.sessionId));
    expect(res.json()).toMatchObject({ decision: "DERIVE", allowed: true, capabilityId: mandate.capability.capabilityId });
    const audit = app.broker.getAudit(mandate.mandate.mandateId);
    expect(audit.entries.at(-1)!.receipt.agentId).toBe(AGENT_IDS.TRAVEL);
  });

  it("A01b Authorization: Bearer <session> is accepted too", async () => {
    const res = await call("/api/v1/context/request", passportValidityAsk, { authorization: `Bearer ${mandate.session.sessionId}` });
    expect(res.json()).toMatchObject({ allowed: true });
  });

  it("A02 body claiming agentId=hotel-agent on a travel session → DENY AGENT_MISMATCH (receipted as the real agent)", async () => {
    const res = await call(
      "/api/v1/context/request",
      { ...passportValidityAsk, agentId: AGENT_IDS.HOTEL },
      asSession(mandate.session.sessionId),
    );
    expect(res.json()).toMatchObject({ decision: "DENY", allowed: false, reasonCode: "AGENT_MISMATCH" });
    expect(res.json().result).toBeUndefined();
    expect(app.broker.getAudit(mandate.mandate.mandateId).entries.at(-1)!.receipt).toMatchObject({
      agentId: AGENT_IDS.TRAVEL,
      reasonCode: "AGENT_MISMATCH",
    });
  });

  it("A02b matching identity echo is accepted (backward compatible with the §6 ContextRequest shape)", async () => {
    const res = await call(
      "/api/v1/context/request",
      {
        ...passportValidityAsk,
        agentId: AGENT_IDS.TRAVEL,
        mandateId: mandate.mandate.mandateId,
        capabilityId: mandate.capability.capabilityId,
        purpose: "travel-booking",
      },
      asSession(mandate.session.sessionId),
    );
    expect(res.json()).toMatchObject({ allowed: true, decision: "DERIVE" });
  });

  it("A03 Hotel Agent session cannot use the Travel Agent capability", async () => {
    const hotel = await delegateHotel();
    const borrow = await call(
      "/api/v1/context/request",
      { ...passportValidityAsk, capabilityId: mandate.capability.capabilityId },
      asSession(hotel.sessionId),
    );
    expect(borrow.json()).toMatchObject({ decision: "DENY", allowed: false, reasonCode: "INVALID_CAPABILITY" });

    const impersonate = await call(
      "/api/v1/context/request",
      { ...passportValidityAsk, agentId: AGENT_IDS.TRAVEL },
      asSession(hotel.sessionId),
    );
    expect(impersonate.json()).toMatchObject({ allowed: false, reasonCode: "AGENT_MISMATCH" });

    // Its own capability does not cover the passport either.
    const own = await call("/api/v1/context/request", passportValidityAsk, asSession(hotel.sessionId));
    expect(own.json()).toMatchObject({ allowed: false, reasonCode: "OUT_OF_SCOPE" });

    // ...but it can do its actual job.
    const ok = await call("/api/v1/context/request", availabilityAsk, asSession(hotel.sessionId));
    expect(ok.json()).toMatchObject({ allowed: true, decision: "DERIVE", capabilityId: hotel.capabilityId });
  });

  it("A03b Hotel session cannot spend a travel-agent tool handle", async () => {
    const hotel = await delegateHotel();
    const travel = asSession(mandate.session.sessionId);
    const ask = (resource: string) => ({ resource, operation: OPERATIONS.ISSUE_HANDLE, requestedMode: "TOOL_BOUND", audience: BOOKING_TOOL_ID });
    const id = (await call("/api/v1/context/request", ask(RESOURCES.PROFILE_LEGAL_NAME), travel)).json().result.handle;
    const pay = (await call("/api/v1/context/request", ask(RESOURCES.PAYMENT_HANDLE), travel)).json().result.handle;
    const res = await call(
      `/api/v1/tools/${BOOKING_TOOL_ID}/invoke`,
      { arguments: { offerId: "SG-HTL-MRNA-02", checkIn: "2026-10-17", checkOut: "2026-10-18", amountUsd: 189, identityHandle: id, paymentHandle: pay } },
      asSession(hotel.sessionId),
    );
    expect(res.json()).toMatchObject({ allowed: false, reasonCode: "TOOL_NOT_ALLOWED" });
    expect(app.booking.bookings).toHaveLength(0);
  });

  it("A04 unknown / missing session → 401 DENY on every agent endpoint, no receipt", async () => {
    const before = app.broker.getAudit(mandate.mandate.mandateId).entries.length;
    const attempts: Array<Record<string, string>> = [{}, asSession("ses_" + "0".repeat(32)), { authorization: "Bearer nope" }];
    for (const headers of attempts) {
      const ctx = await call("/api/v1/context/request", { ...passportValidityAsk, agentId: AGENT_IDS.TRAVEL }, headers);
      expect(ctx.statusCode).toBe(401);
      expect(ctx.json()).toMatchObject({ error: "INVALID_SESSION", allowed: false, decision: "DENY" });
      const del = await call("/api/v1/delegations", { childAgentId: AGENT_IDS.HOTEL, permissions: [] }, headers);
      expect([400, 401]).toContain(del.statusCode);
      const tool = await call(`/api/v1/tools/${BOOKING_TOOL_ID}/invoke`, { arguments: {} }, headers);
      expect(tool.statusCode).toBe(401);
    }
    expect(app.broker.getAudit(mandate.mandate.mandateId).entries.length).toBe(before);
  });

  it("A05 session bound to a revoked capability → DENY CAPABILITY_REVOKED (and its children too)", async () => {
    const hotel = await delegateHotel();
    await call(`/api/v1/capabilities/${mandate.capability.capabilityId}/revoke`, {});
    const travel = await call("/api/v1/context/request", availabilityAsk, asSession(mandate.session.sessionId));
    expect(travel.json()).toMatchObject({ decision: "DENY", reasonCode: "CAPABILITY_REVOKED" });
    const child = await call("/api/v1/context/request", availabilityAsk, asSession(hotel.sessionId));
    expect(child.json()).toMatchObject({ decision: "DENY", reasonCode: "CAPABILITY_REVOKED" });
  });

  it("delegation body cannot name a different parent than its session", async () => {
    const res = await call(
      "/api/v1/delegations",
      {
        parentAgentId: AGENT_IDS.HOTEL,
        childAgentId: AGENT_IDS.HOTEL,
        permissions: [{ resource: RESOURCES.CALENDAR_AVAILABILITY, allowedModes: ["DERIVE"], delegable: false }],
      },
      asSession(mandate.session.sessionId),
    );
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ allowed: false, reasonCode: "AGENT_MISMATCH" });
  });

  it("session tokens never appear in the agent run output (LLM-visible trace)", async () => {
    const run = await call("/api/v1/agent/runs", { mandateId: mandate.mandate.mandateId });
    expect(run.json()).toMatchObject({ status: "BOOKED" });
    expect(run.body).not.toMatch(/ses_[0-9a-f]{32}/);
    expect(run.body).not.toContain(mandate.session.sessionId);
  });
});
