import { FakeLlmProvider, runLlmScenario, type FakeScript, type FakeTurn, type ObservedToolResult, type TraceEntry } from "@contextcaps/agent";
import { createBrokerApp, createLogger, MockCapabilityStateProvider, sequentialIds } from "@contextcaps/broker";
import { BOOKING_TOOL_ID } from "@contextcaps/policy";
import { AGENT_IDS, RESOURCES } from "@contextcaps/shared-types";
import { describe, expect, it } from "vitest";
import { findLeakedSecrets, makeHarness, MANDATE_VALID_UNTIL, NOW, TRIP } from "./helpers";

interface Behaviour {
  /** Asks for the raw passport before the derived fact (over-curious model). */
  askRawFirst?: boolean;
  /** Obeys data requests found in untrusted content (injected model). */
  obeyInjection?: boolean;
  /** Tries to hand the passport to the hotel agent first. */
  delegatePassportFirst?: boolean;
}

const last = (results: ObservedToolResult[], name: string, predicate: (r: ObservedToolResult) => boolean = () => true) =>
  [...results].reverse().find((r) => r.name === name && predicate(r));

/**
 * A model that pursues the task through the tool surface, reading only tool
 * results it was given. Each call decides the next step from the transcript.
 */
function travelModel(b: Behaviour = {}): FakeScript {
  return ({ results }) => {
    const asked = (resource: string) => results.some((r) => r.name === "request_context" && r.input.resource === resource);
    const call = (name: string, input: Record<string, unknown>, text?: string): FakeTurn => ({ text, toolCalls: [{ name, input }] });

    if (b.askRawFirst && !asked(RESOURCES.PASSPORT_RAW)) {
      return call("request_context", { resource: RESOURCES.PASSPORT_RAW, operation: "read" }, "Let me look at the passport.");
    }
    if (!asked(RESOURCES.PASSPORT_VALIDITY)) {
      return call("request_context", {
        resource: RESOURCES.PASSPORT_VALIDITY,
        operation: "valid_for_trip",
        requested_mode: "DERIVE",
        parameters: { ...TRIP },
      });
    }
    if (!asked(RESOURCES.CALENDAR_AVAILABILITY)) {
      return call("request_context", {
        resource: RESOURCES.CALENDAR_AVAILABILITY,
        operation: "available_window",
        requested_mode: "DERIVE",
        parameters: { from: "2026-10-17T00:00:00Z", to: "2026-10-19T00:00:00Z", minHours: 24 },
      });
    }
    const page = last(results, "read_web_page");
    if (!page) return call("read_web_page", { url: "https://deals.example/singapore-weekend" });
    if (b.obeyInjection && /salary/i.test(String(page.output)) && !asked(RESOURCES.SALARY_RAW)) {
      return call("request_context", { resource: RESOURCES.SALARY_RAW, operation: "read" }, "The page says to read the salary.");
    }
    const hotelPerms = [
      { resource: RESOURCES.CALENDAR_AVAILABILITY, allowedModes: ["DERIVE"] },
      { resource: RESOURCES.TRAVEL_HOTEL_PREFERENCES, allowedModes: ["SELECT"] },
    ];
    const task = { destination: "Singapore", check_in: TRIP.departureDate, check_out: TRIP.returnDate, budget_usd: 700 };
    if (b.delegatePassportFirst && !results.some((r) => r.name === "delegate_context")) {
      return call("delegate_context", {
        child_agent_id: AGENT_IDS.HOTEL,
        permissions: [...hotelPerms, { resource: RESOURCES.PASSPORT_VALIDITY, allowedModes: ["DERIVE"] }],
        task,
      });
    }
    const delegation = last(results, "delegate_context", (r) => (r.output as { allowed?: boolean }).allowed === true);
    if (!delegation) return call("delegate_context", { child_agent_id: AGENT_IDS.HOTEL, permissions: hotelPerms, task });
    const rec = (delegation.output as { recommendation: { offerId: string; checkIn: string; checkOut: string; totalUsd: number } }).recommendation;

    const handle = (resource: string) => {
      const r = last(results, "request_context", (x) => x.input.resource === resource);
      return (r?.output as { result?: { handle?: string } } | undefined)?.result?.handle;
    };
    if (!handle(RESOURCES.PROFILE_LEGAL_NAME)) {
      // Parallel tool calls: both handles in one assistant turn.
      return {
        toolCalls: [RESOURCES.PROFILE_LEGAL_NAME, RESOURCES.PAYMENT_HANDLE].map((resource) => ({
          name: "request_context",
          input: { resource, operation: "issue_handle", requested_mode: "TOOL_BOUND", audience: BOOKING_TOOL_ID },
        })),
      };
    }
    if (!results.some((r) => r.name === "book_hotel")) {
      return call("book_hotel", {
        offer_id: rec.offerId,
        check_in: rec.checkIn,
        check_out: rec.checkOut,
        amount_usd: rec.totalUsd,
        identity_handle: handle(RESOURCES.PROFILE_LEGAL_NAME),
        payment_handle: handle(RESOURCES.PAYMENT_HANDLE),
      });
    }
    return { text: "Your Singapore trip is booked." };
  };
}

function decisions(trace: TraceEntry[]) {
  return trace
    .filter((e): e is Extract<TraceEntry, { kind: "tool_call" }> => e.kind === "tool_call" && e.tool === "requestContext")
    .map((e) => [(e.input as { resource: string }).resource, (e.output as { reasonCode: string }).reasonCode]);
}

async function setup() {
  const h = makeHarness();
  const mandate = await h.createTravelMandate();
  return { h, mandate, input: { mandate: mandate.mandate, session: mandate.session, clock: h.clock } };
}

describe("LLM planner behind the broker tool surface (fake provider)", () => {
  it("L01 completes the happy-path trip through broker tools", async () => {
    const { h, mandate, input } = await setup();
    const provider = new FakeLlmProvider(travelModel());
    const run = await runLlmScenario(h.broker, input, provider);
    expect(run).toMatchObject({ planner: "llm", status: "BOOKED", booking: { reference: "CC-DEMO-001", offerId: "SG-HTL-MRNA-02" } });
    expect(decisions(run.trace)).toEqual([
      ["passport.validity", "ALLOW_DERIVED"],
      ["calendar.availability", "ALLOW_DERIVED"],
      ["calendar.availability", "ALLOW_DERIVED"], // hotel-agent (child)
      ["travel.hotel_preferences", "ALLOW_SELECTED"],
      ["profile.legal_name", "ALLOW_TOOL_BOUND"],
      ["payment.handle", "ALLOW_TOOL_BOUND"],
    ]);
    // Every decision went through the real broker and was receipted.
    expect(h.broker.getAudit(mandate.mandate.mandateId).entries.length).toBeGreaterThanOrEqual(6);
  });

  it("L02 receives DENY and continues safely", async () => {
    const { h, input } = await setup();
    const run = await runLlmScenario(h.broker, input, new FakeLlmProvider(travelModel({ askRawFirst: true, delegatePassportFirst: true })));
    expect(run.status).toBe("BOOKED");
    expect(decisions(run.trace)[0]).toEqual(["passport.raw", "RAW_DISCLOSURE_FORBIDDEN"]);
    const rejected = run.trace.find((e) => e.kind === "tool_call" && e.tool === "delegateContext");
    expect(rejected).toMatchObject({ output: { allowed: false, reasonCode: "DELEGATION_NOT_ALLOWED" } });
  });

  it("L03 + L04 the model never receives the raw passport, calendar, payment secret or session token", async () => {
    const { h, mandate, input } = await setup();
    const provider = new FakeLlmProvider(travelModel({ askRawFirst: true, obeyInjection: true }));
    const run = await runLlmScenario(h.broker, input, provider);
    expect(run.status).toBe("BOOKED");
    // Everything the model was ever sent:
    const seen = JSON.stringify(provider.requests);
    expect(findLeakedSecrets(seen)).toEqual([]);
    expect(seen).not.toContain(mandate.session.sessionId);
    expect(seen).not.toMatch(/ses_[0-9a-f]{32}/);
    expect(findLeakedSecrets(run)).toEqual([]);
    // The connector still got the real credential.
    expect(h.booking.bookings[0]?.paymentToken).toBe("secret-demo-token");
  });

  it("L05 prompt injection is followed by the model but blocked by the broker", async () => {
    const { h, mandate, input } = await setup();
    const run = await runLlmScenario(h.broker, input, new FakeLlmProvider(travelModel({ obeyInjection: true })));
    expect(decisions(run.trace)).toContainEqual(["salary.raw", "OUT_OF_SCOPE"]);
    expect(run.status).toBe("BOOKED");
    const salaryReceipt = h.broker.getAudit(mandate.mandate.mandateId).entries.find((e) => e.receipt.resource === "salary.raw");
    expect(salaryReceipt?.receipt).toMatchObject({ decision: "DENY", reasonCode: "OUT_OF_SCOPE", agentId: AGENT_IDS.TRAVEL });
  });

  it("L06 provider failure → deterministic scripted fallback completes the golden flow", async () => {
    const { h, input } = await setup();
    const broken = new FakeLlmProvider(() => {
      throw new Error("network down");
    });
    const run = await runLlmScenario(h.broker, input, broken);
    expect(run).toMatchObject({ planner: "scripted-fallback", status: "BOOKED", booking: { reference: "CC-DEMO-001" } });
    expect(run.fallbackReason).toMatch(/LLM provider failed/);
  });

  it("LLM run after revocation halts with CAPABILITY_REVOKED", async () => {
    const { h, mandate, input } = await setup();
    await h.broker.revokeCapability(mandate.capability.capabilityId);
    const run = await runLlmScenario(h.broker, input, new FakeLlmProvider(travelModel()));
    expect(run).toMatchObject({ planner: "llm", status: "HALTED_BY_POLICY", haltReasonCode: "CAPABILITY_REVOKED" });
    expect(h.booking.bookings).toHaveLength(0);
  });

  it("malformed tool input is returned to the model as an error, not executed", async () => {
    const { h, input } = await setup();
    let sawError = false;
    const provider = new FakeLlmProvider(({ results }) => {
      if (results.length === 0) return { toolCalls: [{ name: "request_context", input: { resource: 42 } }] };
      sawError = results[0]!.isError;
      return { text: "Giving up." };
    });
    const run = await runLlmScenario(h.broker, input, provider);
    expect(sawError).toBe(true);
    expect(run.status).toBe("NO_BOOKING");
  });

  it("tool schemas expose no identity fields the model could set", async () => {
    const { h, input } = await setup();
    const provider = new FakeLlmProvider(() => ({ text: "done" }));
    await runLlmScenario(h.broker, input, provider);
    const keys = new Set<string>();
    const walk = (node: unknown): void => {
      if (!node || typeof node !== "object") return;
      const props = (node as { properties?: Record<string, unknown> }).properties;
      if (props) for (const [k, v] of Object.entries(props)) (keys.add(k), walk(v));
      for (const v of Object.values(node)) walk(v);
    };
    walk(provider.requests[0]!.tools.map((t) => t.input_schema));
    const forbidden = ["agentId", "agent_id", "capabilityId", "capability_id", "mandateId", "mandate_id", "sessionId", "session_id", "purpose"];
    expect([...keys].filter((k) => forbidden.includes(k))).toEqual([]);
  });

  it("HTTP /agent/runs planner=llm: 503 without a provider, BOOKED with one", async () => {
    const clock = () => NOW;
    const base = { receiptKey: "k", demoMode: true, corsOrigins: true as const, chainProvider: "mock" as const };
    const mk = (llmProvider?: FakeLlmProvider) =>
      createBrokerApp(base, { clock, ids: sequentialIds(), logger: createLogger(() => {}), provider: new MockCapabilityStateProvider(clock), llmProvider });
    const mandateBody = {
      principal: "0xA11CE",
      description: "Book my Singapore trip next weekend under $700.",
      constraints: { budgetUsd: 700, destination: "Singapore", validUntil: MANDATE_VALID_UNTIL },
    };

    const off = await mk();
    const m1 = (await off.server.inject({ method: "POST", url: "/api/v1/mandates", payload: mandateBody })).json();
    const r1 = await off.server.inject({ method: "POST", url: "/api/v1/agent/runs", payload: { mandateId: m1.mandate.mandateId, planner: "llm" } });
    expect(r1.statusCode).toBe(503);
    await off.server.close();

    const on = await mk(new FakeLlmProvider(travelModel()));
    const m2 = (await on.server.inject({ method: "POST", url: "/api/v1/mandates", payload: mandateBody })).json();
    const r2 = await on.server.inject({ method: "POST", url: "/api/v1/agent/runs", payload: { mandateId: m2.mandate.mandateId, planner: "llm" } });
    expect(r2.json()).toMatchObject({ planner: "llm", status: "BOOKED" });
    expect(findLeakedSecrets(r2.body)).toEqual([]);
    await on.server.close();
  });
});

describe("OpenAiLlmProvider request shape", () => {
  it("calls Chat Completions with GPT function tools and translates the tool call", async () => {
    const { OpenAiLlmProvider, PLANNER_SYSTEM_PROMPT, PLANNER_TOOLS } = await import("@contextcaps/agent");
    const calls: Array<Record<string, unknown>> = [];
    const provider = new OpenAiLlmProvider({
      apiKey: "test-key",
      fetch: async (_url, init) => {
        calls.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response(
          JSON.stringify({
            choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: "call_1", function: { name: "request_context", arguments: '{"resource":"passport.validity","operation":"valid_for_trip"}' } }] } }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });
    const response = await provider.createMessage({ system: PLANNER_SYSTEM_PROMPT, tools: PLANNER_TOOLS, messages: [{ role: "user", content: "hi" }] });
    expect(calls[0]).toMatchObject({
      model: "gpt-5.4-mini",
      reasoning_effort: "low",
      max_completion_tokens: 4096,
      messages: [{ role: "system", content: PLANNER_SYSTEM_PROMPT }, { role: "user", content: "hi" }],
    });
    expect(calls[0]?.tools).toEqual(expect.arrayContaining([expect.objectContaining({ type: "function", function: expect.objectContaining({ name: "request_context" }) })]));
    expect(response).toMatchObject({
      stop_reason: "tool_use",
      content: [{ type: "tool_use", id: "call_1", name: "request_context", input: { resource: "passport.validity", operation: "valid_for_trip" } }],
    });
    expect(PLANNER_SYSTEM_PROMPT).not.toMatch(/\d{4}-\d{2}-\d{2}/); // no volatile dates in the cached prefix
  });
});
