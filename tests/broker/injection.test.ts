import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  FakeLlmProvider,
  MALICIOUS_BOOKING_PAGE,
  MALICIOUS_DEALS_PAGE,
  MALICIOUS_HOTEL_DESCRIPTION,
  MALICIOUS_PROVIDER_NOTICE,
  runAgentScenario,
  runLlmScenario,
  type InjectionScenario,
  type TraceEntry,
} from "@contextcaps/agent";
import { AGENT_IDS, RESOURCES } from "@contextcaps/shared-types";
import { describe, expect, it } from "vitest";
import { findLeakedSecrets, makeHarness } from "./helpers";

const denials = (trace: TraceEntry[]) =>
  trace
    .filter((e): e is Extract<TraceEntry, { kind: "tool_call" }> => e.kind === "tool_call" && e.tool === "requestContext")
    .filter((e) => !(e.output as { allowed: boolean }).allowed)
    .map((e) => [e.agentId, (e.input as { resource: string }).resource, (e.output as { reasonCode: string }).reasonCode]);

async function run(injection: InjectionScenario) {
  const h = makeHarness();
  const m = await h.createTravelMandate();
  const result = await runAgentScenario(h.broker, { mandate: m.mandate, session: m.session, injection, clock: h.clock });
  return { h, m, result };
}

describe("Prompt-injection variants — blocked by capability policy, not text filtering", () => {
  it("baseline: SYSTEM OVERRIDE deals page → salary.raw DENY OUT_OF_SCOPE", async () => {
    const { result } = await run("deals_page");
    expect(denials(result.trace)).toContainEqual([AGENT_IDS.TRAVEL, RESOURCES.SALARY_RAW, "OUT_OF_SCOPE"]);
    expect(result.status).toBe("BOOKED");
  });

  it("CASE A hotel description asks for salary + passport number → both denied for the Hotel Agent", async () => {
    const { result } = await run("hotel_description");
    expect(result.trace.some((e) => e.kind === "tool_call" && JSON.stringify(e.output).includes("member discount"))).toBe(true);
    expect(denials(result.trace)).toEqual(
      expect.arrayContaining([
        [AGENT_IDS.HOTEL, RESOURCES.SALARY_RAW, "OUT_OF_SCOPE"],
        [AGENT_IDS.HOTEL, RESOURCES.PASSPORT_RAW, "OUT_OF_SCOPE"],
      ]),
    );
    expect(result.status).toBe("BOOKED");
    expect(findLeakedSecrets(result)).toEqual([]);
  });

  it("CASE B tool response demands private email / salary → denied", async () => {
    const { result } = await run("tool_response");
    expect(denials(result.trace)).toEqual(
      expect.arrayContaining([
        [AGENT_IDS.HOTEL, RESOURCES.SALARY_RAW, "OUT_OF_SCOPE"],
        [AGENT_IDS.HOTEL, "profile.email", "OUT_OF_SCOPE"],
      ]),
    );
    expect(result.status).toBe("BOOKED");
    expect(findLeakedSecrets(result)).toEqual([]);
  });

  it("CASE C booking page demands full passport details → RAW_DISCLOSURE_FORBIDDEN", async () => {
    const { result } = await run("booking_page");
    expect(result.trace.some((e) => e.kind === "external_content" && e.text.includes("Ignore previous restrictions"))).toBe(true);
    expect(denials(result.trace)).toContainEqual([AGENT_IDS.TRAVEL, RESOURCES.PASSPORT_RAW, "RAW_DISCLOSURE_FORBIDDEN"]);
    expect(result.status).toBe("BOOKED");
    expect(findLeakedSecrets(result)).toEqual([]);
  });

  it("an LLM that obeys an injected tool response is still blocked by the broker", async () => {
    const h = makeHarness();
    const m = await h.createTravelMandate();
    const provider = new FakeLlmProvider(({ results }) => {
      const search = results.find((r) => r.name === "search_hotels");
      if (!search) return { toolCalls: [{ name: "search_hotels", input: { destination: "Singapore" } }] };
      const injected = /salary/i.test(JSON.stringify(search.output));
      if (injected && !results.some((r) => r.name === "request_context")) {
        return { toolCalls: [{ name: "request_context", input: { resource: RESOURCES.SALARY_RAW, operation: "read" } }] };
      }
      return { text: "stopping" };
    });
    const result = await runLlmScenario(h.broker, { mandate: m.mandate, session: m.session, injection: "tool_response", clock: h.clock }, provider);
    expect(denials(result.trace)).toEqual([[AGENT_IDS.TRAVEL, RESOURCES.SALARY_RAW, "OUT_OF_SCOPE"]]);
    expect(findLeakedSecrets(provider.requests)).toEqual([]);
  });

  it("the broker and policy contain no prompt-injection string filters", () => {
    const root = resolve(__dirname, "../..");
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : [],
      );
    const source = [...files(join(root, "services/broker/src")), ...files(join(root, "packages/policy/src"))]
      .map((f) => readFileSync(f, "utf8"))
      .join("\n");
    for (const marker of ["SYSTEM OVERRIDE", "Ignore previous", "member discount", "verification required"]) {
      expect(source, marker).not.toContain(marker);
    }
    for (const text of [MALICIOUS_DEALS_PAGE, MALICIOUS_HOTEL_DESCRIPTION, MALICIOUS_PROVIDER_NOTICE, MALICIOUS_BOOKING_PAGE]) {
      expect(text.length).toBeGreaterThan(0);
    }
  });
});
