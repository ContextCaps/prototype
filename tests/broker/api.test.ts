import { createBrokerApp, createLogger, MockCapabilityStateProvider, sequentialIds, type BrokerApp } from "@contextcaps/broker";
import { BOOKING_TOOL_ID, OPERATIONS } from "@contextcaps/policy";
import { AGENT_IDS, RESOURCES, type CreateMandateResponse, type ToolBoundHandle } from "@contextcaps/shared-types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { availabilityAsk, findLeakedSecrets, MANDATE_VALID_UNTIL, NOW, passportValidityAsk, toolBoundAsk } from "./helpers";

describe("Broker HTTP API /api/v1", () => {
  let app: BrokerApp;
  let logLines: string[];
  let mandate: CreateMandateResponse;
  let rootSession: string | undefined;
  let n = 0;

  const ctxRequest = (overrides: Record<string, unknown>) => ({
    requestId: `req_api_${++n}`,
    mandateId: mandate.mandate.mandateId,
    capabilityId: mandate.capability.capabilityId,
    agentId: AGENT_IDS.TRAVEL,
    purpose: mandate.mandate.purpose,
    timestamp: NOW.toISOString(),
    ...overrides,
  });

  /** POSTs as the mandate's root agent (travel-agent) unless another session token is given. */
  const post = (url: string, payload: unknown, sessionId: string | undefined = rootSession) =>
    app.server.inject({
      method: "POST",
      url,
      payload: payload as object,
      headers: sessionId ? { "x-contextcaps-session": sessionId } : {},
    });

  beforeEach(async () => {
    logLines = [];
    rootSession = undefined;
    const clock = () => NOW;
    app = await createBrokerApp(
      { receiptKey: "test-key", demoMode: true, corsOrigins: true, chainProvider: "mock" },
      {
        clock,
        ids: sequentialIds(),
        logger: createLogger((l) => logLines.push(l)),
        provider: new MockCapabilityStateProvider(clock),
      },
    );
    const res = await post("/api/v1/mandates", {
      principal: "0xA11CE",
      description: "Book my Singapore trip next weekend under $700.",
      constraints: { budgetUsd: 700, destination: "Singapore", validUntil: MANDATE_VALID_UNTIL },
    });
    expect(res.statusCode).toBe(201);
    mandate = res.json();
    rootSession = mandate.session.sessionId;
  });

  afterEach(async () => {
    await app.server.close();
  });

  it("POST /mandates returns mandate, root capability and chain tx", () => {
    expect(mandate.mandate).toMatchObject({ mandateId: "mdt_0001", purpose: "travel-booking", rootAgentId: AGENT_IDS.TRAVEL, status: "ACTIVE" });
    expect(mandate.capability).toMatchObject({ capabilityId: "cap_0001", agentId: AGENT_IDS.TRAVEL, status: "ACTIVE" });
    expect(mandate.chain.txHash).toMatch(/^0x/);
  });

  it("POST /mandates rejects malformed input with 400 and no echo", async () => {
    const res = await post("/api/v1/mandates", { principal: "", description: "x", constraints: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "INVALID_REQUEST" });
    const unknownPurpose = await post("/api/v1/mandates", { principal: "p", description: "d", purpose: "spy", constraints: {} });
    expect(unknownPurpose.statusCode).toBe(400);
  });

  it("POST /context/request returns a DisclosureDecision for deny and derive", async () => {
    const denied = await post("/api/v1/context/request", ctxRequest({ resource: RESOURCES.PASSPORT_RAW, operation: OPERATIONS.READ }));
    expect(denied.statusCode).toBe(200);
    expect(denied.json()).toMatchObject({ decision: "DENY", allowed: false, reasonCode: "RAW_DISCLOSURE_FORBIDDEN", capabilityId: "cap_0001" });

    const derived = await post("/api/v1/context/request", ctxRequest(passportValidityAsk));
    expect(derived.json()).toMatchObject({ decision: "DERIVE", allowed: true, result: { valid: true } });
    expect(derived.json().policyHash).toBe(mandate.capability.policyHash);
  });

  it("POST /context/request validates the ContextRequest shape", async () => {
    const res = await post("/api/v1/context/request", { resource: "salary.raw" });
    expect(res.statusCode).toBe(400);
    const badMode = await post("/api/v1/context/request", ctxRequest({ ...passportValidityAsk, requestedMode: "RAW" }));
    expect(badMode.statusCode).toBe(400);
  });

  it("salary request via HTTP → DENY OUT_OF_SCOPE", async () => {
    const res = await post("/api/v1/context/request", ctxRequest({ resource: RESOURCES.SALARY_RAW, operation: OPERATIONS.READ }));
    expect(res.json()).toMatchObject({ decision: "DENY", allowed: false, reasonCode: "OUT_OF_SCOPE" });
  });

  it("POST /delegations: 201 for valid, 403 with reasonCode for invalid", async () => {
    const base = {
      mandateId: mandate.mandate.mandateId,
      parentCapabilityId: mandate.capability.capabilityId,
      parentAgentId: AGENT_IDS.TRAVEL,
      childAgentId: AGENT_IDS.HOTEL,
      purpose: mandate.mandate.purpose,
    };
    const ok = await post("/api/v1/delegations", {
      ...base,
      permissions: [
        { resource: RESOURCES.CALENDAR_AVAILABILITY, allowedModes: ["DERIVE"], delegable: false },
        { resource: RESOURCES.TRAVEL_HOTEL_PREFERENCES, allowedModes: ["SELECT"], delegable: false },
      ],
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({ allowed: true, capability: { agentId: AGENT_IDS.HOTEL, delegationDepth: 1 } });

    const passport = await post("/api/v1/delegations", {
      ...base,
      permissions: [{ resource: RESOURCES.PASSPORT_VALIDITY, allowedModes: ["DERIVE"], delegable: false }],
    });
    expect(passport.statusCode).toBe(403);
    expect(passport.json()).toMatchObject({ allowed: false, reasonCode: "DELEGATION_NOT_ALLOWED" });
  });

  it("revoke → GET shows REVOKED → next request denied CAPABILITY_REVOKED", async () => {
    const before = await app.server.inject({ method: "GET", url: `/api/v1/capabilities/${mandate.capability.capabilityId}` });
    expect(before.json()).toMatchObject({ capability: { status: "ACTIVE" }, chain: { provider: "mock", status: "ACTIVE" } });

    const revoke = await post(`/api/v1/capabilities/${mandate.capability.capabilityId}/revoke`, {});
    expect(revoke.statusCode).toBe(200);
    expect(revoke.json()).toMatchObject({ capability: { status: "REVOKED" }, chain: { status: "REVOKED" } });
    expect(revoke.json().chain.revocationTxHash).toMatch(/^0x/);

    const retry = await post("/api/v1/context/request", ctxRequest(availabilityAsk));
    expect(retry.json()).toMatchObject({ decision: "DENY", allowed: false, reasonCode: "CAPABILITY_REVOKED" });
  });

  it("GET /capabilities/:id and revoke return 404 for unknown ids", async () => {
    expect((await app.server.inject({ method: "GET", url: "/api/v1/capabilities/nope" })).statusCode).toBe(404);
    expect((await post("/api/v1/capabilities/nope/revoke", {})).statusCode).toBe(404);
  });

  it("tool-bound checkout over HTTP never returns the secret", async () => {
    const identity = await post("/api/v1/context/request", ctxRequest(toolBoundAsk(RESOURCES.PROFILE_LEGAL_NAME)));
    const payment = await post("/api/v1/context/request", ctxRequest(toolBoundAsk(RESOURCES.PAYMENT_HANDLE)));
    const res = await post(`/api/v1/tools/${BOOKING_TOOL_ID}/invoke`, {
      requestId: "req_api_book",
      mandateId: mandate.mandate.mandateId,
      capabilityId: mandate.capability.capabilityId,
      agentId: AGENT_IDS.TRAVEL,
      purpose: mandate.mandate.purpose,
      arguments: {
        offerId: "SG-HTL-MRNA-02",
        checkIn: "2026-10-17",
        checkOut: "2026-10-18",
        amountUsd: 189,
        identityHandle: (identity.json().result as ToolBoundHandle).handle,
        paymentHandle: (payment.json().result as ToolBoundHandle).handle,
      },
    });
    expect(res.json()).toMatchObject({ allowed: true, result: { bookingStatus: "CONFIRMED", reference: "CC-DEMO-001" } });
    expect(findLeakedSecrets(res.body)).toEqual([]);
    expect(findLeakedSecrets(identity.body + payment.body)).toEqual([]);
  });

  it("POST /agent/runs runs the golden flow; GET /audit returns receipts and lifecycle", async () => {
    const run = await post("/api/v1/agent/runs", { mandateId: mandate.mandate.mandateId });
    expect(run.statusCode).toBe(200);
    expect(run.json()).toMatchObject({ status: "BOOKED", booking: { reference: "CC-DEMO-001" } });
    expect(findLeakedSecrets(run.body)).toEqual([]);

    const audit = await app.server.inject({ method: "GET", url: `/api/v1/audit?mandateId=${mandate.mandate.mandateId}` });
    expect(audit.statusCode).toBe(200);
    const body = audit.json();
    expect(body.entries.length).toBeGreaterThanOrEqual(9);
    expect(body.delegations).toHaveLength(1);
    expect(body.lifecycle.map((e: { type: string }) => e.type)).toEqual(["MANDATE_CREATED", "DELEGATION_CREATED"]);
    expect(findLeakedSecrets(audit.body)).toEqual([]);
    expect(findLeakedSecrets(logLines.join("\n"))).toEqual([]);

    expect((await app.server.inject({ method: "GET", url: "/api/v1/audit" })).statusCode).toBe(400);
  });

  it("POST /agent/runs with scenario=retry after revoke halts with CAPABILITY_REVOKED", async () => {
    await post(`/api/v1/capabilities/${mandate.capability.capabilityId}/revoke`, {});
    const run = await post("/api/v1/agent/runs", { mandateId: mandate.mandate.mandateId, scenario: "retry" });
    expect(run.json()).toMatchObject({ status: "HALTED_BY_POLICY", haltReasonCode: "CAPABILITY_REVOKED" });
  });

  it("POST /demo/reset clears state", async () => {
    expect((await post("/api/v1/demo/reset", {})).json()).toEqual({ ok: true });
    expect((await app.server.inject({ method: "GET", url: `/api/v1/capabilities/${mandate.capability.capabilityId}` })).statusCode).toBe(404);
    const again = await post("/api/v1/mandates", {
      principal: "0xA11CE",
      description: "Book my Singapore trip next weekend under $700.",
      constraints: { budgetUsd: 700, destination: "Singapore", validUntil: MANDATE_VALID_UNTIL },
    });
    expect(again.json().capability.capabilityId).toBe("cap_0001");
  });
});
