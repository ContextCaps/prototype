import { runAgentScenario, type TraceEntry } from "@contextcaps/agent";
import { AGENT_IDS } from "@contextcaps/shared-types";
import { describe, expect, it } from "vitest";
import { findLeakedSecrets, makeHarness } from "./helpers";

type ToolCall = Extract<TraceEntry, { kind: "tool_call" }>;

function contextCalls(trace: TraceEntry[]) {
  return trace
    .filter((e): e is ToolCall => e.kind === "tool_call" && e.tool === "requestContext")
    .map((e) => ({
      agentId: e.agentId,
      resource: (e.input as { resource: string }).resource,
      decision: (e.output as { decision: string }).decision,
      reasonCode: (e.output as { reasonCode: string }).reasonCode,
      result: (e.output as { result?: unknown }).result,
    }));
}

describe("Golden demo flow (agent runtime → real broker path)", () => {
  it("runs end-to-end: deny raw, derive, block injection, delegate, tool-bound checkout, revoke, retry denied", async () => {
    const h = makeHarness();
    const mandate = await h.createTravelMandate();

    const run = await runAgentScenario(h.broker, {
      mandate: mandate.mandate,
      session: mandate.session,
      clock: h.clock,
    });

    expect(run.status).toBe("BOOKED");
    expect(run.booking).toMatchObject({ reference: "CC-DEMO-001", offerId: "SG-HTL-MRNA-02", totalUsd: 189 });

    const calls = contextCalls(run.trace);
    expect(calls.map((c) => [c.agentId, c.resource, c.decision, c.reasonCode])).toEqual([
      [AGENT_IDS.TRAVEL, "passport.raw", "DENY", "RAW_DISCLOSURE_FORBIDDEN"],
      [AGENT_IDS.TRAVEL, "passport.validity", "DERIVE", "ALLOW_DERIVED"],
      [AGENT_IDS.TRAVEL, "calendar.raw", "DENY", "RAW_DISCLOSURE_FORBIDDEN"],
      [AGENT_IDS.TRAVEL, "calendar.availability", "DERIVE", "ALLOW_DERIVED"],
      [AGENT_IDS.TRAVEL, "salary.raw", "DENY", "OUT_OF_SCOPE"],
      [AGENT_IDS.HOTEL, "calendar.availability", "DERIVE", "ALLOW_DERIVED"],
      [AGENT_IDS.HOTEL, "travel.hotel_preferences", "SELECT", "ALLOW_SELECTED"],
      [AGENT_IDS.TRAVEL, "profile.legal_name", "TOOL_BOUND", "ALLOW_TOOL_BOUND"],
      [AGENT_IDS.TRAVEL, "payment.handle", "TOOL_BOUND", "ALLOW_TOOL_BOUND"],
    ]);
    expect(calls[1]!.result).toEqual({ valid: true });

    // The injection was seen as untrusted external content.
    expect(run.trace.some((e) => e.kind === "external_content" && /SYSTEM OVERRIDE/.test(e.text))).toBe(true);

    // Hotel Agent ran on a narrower child capability.
    const child = await h.broker.getCapability(run.childCapabilityId!);
    expect(child?.capability.agentId).toBe(AGENT_IDS.HOTEL);
    expect(child?.capability.permissions.map((p) => p.resource).sort()).toEqual(["calendar.availability", "travel.hotel_preferences"]);

    // INV-08 / INV-09: nothing private entered the LLM-visible trace.
    expect(findLeakedSecrets(run)).toEqual([]);
    // ...but the booking connector did receive the real credential.
    expect(h.booking.bookings[0]?.paymentToken).toBe("secret-demo-token");
    // Logs and audit are clean too.
    expect(findLeakedSecrets(h.logLines.join("\n"))).toEqual([]);
    expect(findLeakedSecrets(h.broker.getAudit(mandate.mandate.mandateId))).toEqual([]);

    // Scene 8 — user revokes; the retry is denied by the broker.
    await h.broker.revokeCapability(mandate.capability.capabilityId);
    const retry = await runAgentScenario(h.broker, {
      mandate: mandate.mandate,
      session: mandate.session,
      scenario: "retry",
      clock: h.clock,
    });
    expect(retry).toMatchObject({ status: "HALTED_BY_POLICY", haltReasonCode: "CAPABILITY_REVOKED" });
    expect(contextCalls(retry.trace)).toMatchObject([{ resource: "calendar.availability", decision: "DENY", reasonCode: "CAPABILITY_REVOKED" }]);

    // Every decision produced a receipt.
    const audit = h.broker.getAudit(mandate.mandate.mandateId);
    expect(audit.entries.filter((e) => e.kind === "context_request")).toHaveLength(calls.length + 1);
    expect(audit.lifecycle.map((e) => e.type)).toEqual(["MANDATE_CREATED", "DELEGATION_CREATED", "CAPABILITY_REVOKED"]);
  });

  it("a full re-run after revocation halts at the first request", async () => {
    const h = makeHarness();
    const mandate = await h.createTravelMandate();
    await h.broker.revokeCapability(mandate.capability.capabilityId);
    const run = await runAgentScenario(h.broker, {
      mandate: mandate.mandate,
      session: mandate.session,
      clock: h.clock,
    });
    expect(run).toMatchObject({ status: "HALTED_BY_POLICY", haltReasonCode: "CAPABILITY_REVOKED" });
    expect(h.booking.bookings).toHaveLength(0);
  });
});
