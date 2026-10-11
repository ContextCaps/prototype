import { runAgentScenario } from "@contextcaps/agent";
import type { ToolConnector } from "@contextcaps/broker";
import { BOOKING_TOOL_ID } from "@contextcaps/policy";
import { RESOURCES, type ToolBoundHandle } from "@contextcaps/shared-types";
import { beforeEach, describe, expect, it } from "vitest";
import { findLeakedSecrets, makeHarness, toolBoundAsk, type Harness } from "./helpers";

/** A second approved connector, used to prove handles are bound to ONE tool. */
class MockFlightConnector implements ToolConnector {
  readonly toolId = "demo-flight-connector";
  readonly handleArguments = { paymentHandle: RESOURCES.PAYMENT_HANDLE };
  readonly outputFields = ["status"];
  executions = 0;
  validate(): string | undefined {
    return undefined;
  }
  async execute(): Promise<Record<string, unknown>> {
    this.executions += 1;
    return { status: "TICKETED" };
  }
}

describe("TOOL_BOUND credential lifecycle (TBA01–TBA08)", () => {
  let h: Harness;
  let flight: MockFlightConnector;
  let mandate: Awaited<ReturnType<Harness["createTravelMandate"]>>;

  const bookingArgs = (handles: { identityHandle: string; paymentHandle: string }, amountUsd = 189) => ({
    arguments: { offerId: "SG-HTL-MRNA-02", checkIn: "2026-10-17", checkOut: "2026-10-18", amountUsd, ...handles },
  });

  async function issue(sessionId: string) {
    const get = async (resource: string) =>
      ((await h.broker.requestContextForSession(sessionId, toolBoundAsk(resource))).result as ToolBoundHandle).handle;
    return { identityHandle: await get(RESOURCES.PROFILE_LEGAL_NAME), paymentHandle: await get(RESOURCES.PAYMENT_HANDLE) };
  }

  beforeEach(async () => {
    flight = new MockFlightConnector();
    h = makeHarness({ extraConnectors: [flight] });
    mandate = await h.createTravelMandate();
  });

  it("handles are opaque and non-semantic", async () => {
    const handles = await issue(mandate.session.sessionId);
    for (const handle of Object.values(handles)) {
      expect(handle).toMatch(/^tbh_[0-9a-f]{32}$/);
      expect(handle).not.toMatch(/payment|legal|passport|alex|token/i);
    }
    expect(handles.identityHandle).not.toBe(handles.paymentHandle);
  });

  it("TBA01 a handle is single-use", async () => {
    const handles = await issue(mandate.session.sessionId);
    expect((await h.broker.invokeToolForSession(mandate.session.sessionId, BOOKING_TOOL_ID, bookingArgs(handles))).allowed).toBe(true);
    const second = await h.broker.invokeToolForSession(mandate.session.sessionId, BOOKING_TOOL_ID, bookingArgs(handles));
    expect(second).toMatchObject({ allowed: false, reasonCode: "TOOL_NOT_ALLOWED" });
  });

  it("TBA02 an expired handle is rejected", async () => {
    const handles = await issue(mandate.session.sessionId);
    h.setNow(new Date(h.clock().getTime() + 15 * 60 * 1000 + 1));
    const res = await h.broker.invokeToolForSession(mandate.session.sessionId, BOOKING_TOOL_ID, bookingArgs(handles));
    expect(res).toMatchObject({ allowed: false, reasonCode: "TOOL_NOT_ALLOWED" });
    expect(h.booking.bookings).toHaveLength(0);
  });

  it("TBA03 a different agent cannot use the handle", async () => {
    const handles = await issue(mandate.session.sessionId);
    const child = await h.broker.delegateForSession(mandate.session.sessionId, {
      childAgentId: "hotel-agent",
      permissions: [{ resource: RESOURCES.CALENDAR_AVAILABILITY, allowedModes: ["DERIVE"], delegable: false }],
    });
    if (!child.allowed) throw new Error("delegation failed");
    const res = await h.broker.invokeToolForSession(child.childSession.sessionId, BOOKING_TOOL_ID, bookingArgs(handles));
    expect(res).toMatchObject({ allowed: false, reasonCode: "TOOL_NOT_ALLOWED" });
    expect(h.booking.bookings).toHaveLength(0);
  });

  it("TBA04 a handle bound to the booking tool cannot be spent at another approved tool", async () => {
    const handles = await issue(mandate.session.sessionId);
    const res = await h.broker.invokeToolForSession(mandate.session.sessionId, flight.toolId, {
      arguments: { paymentHandle: handles.paymentHandle },
    });
    expect(res).toMatchObject({ allowed: false, reasonCode: "AUDIENCE_NOT_ALLOWED" });
    expect(flight.executions).toBe(0);
  });

  it("TBA04b a handle cannot even be issued for a tool outside the capability's audience", async () => {
    const d = await h.broker.requestContextForSession(mandate.session.sessionId, {
      ...toolBoundAsk(RESOURCES.PAYMENT_HANDLE),
      audience: flight.toolId,
    });
    expect(d).toMatchObject({ allowed: false, reasonCode: "AUDIENCE_NOT_ALLOWED" });
  });

  it("TBA05 replaying a successful invocation is rejected and books nothing", async () => {
    const handles = await issue(mandate.session.sessionId);
    const req = { requestId: "req_replay", ...bookingArgs(handles) };
    expect((await h.broker.invokeToolForSession(mandate.session.sessionId, BOOKING_TOOL_ID, req)).allowed).toBe(true);
    const replay = await h.broker.invokeToolForSession(mandate.session.sessionId, BOOKING_TOOL_ID, req);
    expect(replay).toMatchObject({ allowed: false, reasonCode: "TOOL_NOT_ALLOWED" });
    expect(h.booking.bookings).toHaveLength(1);
  });

  it("TBA06 a handle from a different mandate is rejected", async () => {
    const other = await h.createTravelMandate();
    const foreign = await issue(other.session.sessionId);
    const res = await h.broker.invokeToolForSession(mandate.session.sessionId, BOOKING_TOOL_ID, bookingArgs(foreign));
    expect(res).toMatchObject({ allowed: false, reasonCode: "TOOL_NOT_ALLOWED" });
    expect(h.booking.bookings).toHaveLength(0);
  });

  it("TBA07 a booking above the mandate budget is rejected", async () => {
    const res = await h.broker.invokeToolForSession(
      mandate.session.sessionId,
      BOOKING_TOOL_ID,
      bookingArgs(await issue(mandate.session.sessionId), 700.01),
    );
    expect(res).toMatchObject({ allowed: false, reasonCode: "OUT_OF_SCOPE" });
    expect(h.booking.bookings).toHaveLength(0);
  });

  it("TBA07b a rejected attempt does not burn the handle; a valid retry succeeds", async () => {
    const handles = await issue(mandate.session.sessionId);
    await h.broker.invokeToolForSession(mandate.session.sessionId, BOOKING_TOOL_ID, bookingArgs(handles, 9999));
    const ok = await h.broker.invokeToolForSession(mandate.session.sessionId, BOOKING_TOOL_ID, bookingArgs(handles));
    expect(ok.allowed).toBe(true);
  });

  it("TBA08 the tool secret is absent from logs, receipts, LLM trace, API responses and anchored data", async () => {
    const run = await runAgentScenario(h.broker, { mandate: mandate.mandate, session: mandate.session, clock: h.clock });
    expect(run.status).toBe("BOOKED");
    expect(h.booking.bookings[0]?.paymentToken).toBe("secret-demo-token"); // the connector did get it

    const surfaces = {
      llmTrace: run.trace,
      apiResponse: run,
      receipts: h.broker.getAudit(mandate.mandate.mandateId),
      anchored: h.provider.anchoredReceipts,
      logs: h.logLines.join("\n"),
    };
    for (const [name, surface] of Object.entries(surfaces)) {
      expect(findLeakedSecrets(surface), name).toEqual([]);
    }
  });
});
