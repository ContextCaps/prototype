import type { AgentSessionGrant, TaskMandate } from "@contextcaps/shared-types";
import { createEnvironment, type InjectionScenario } from "./environment";
import type { BrokerPort } from "./port";
import { AgentSession } from "./session";
import { Trace } from "./trace";
import { runLlmTravelAgent } from "./llm/planner";
import type { LlmProvider } from "./llm/provider";
import { GOLDEN_TASK, runRetryAfterRevoke, runTravelAgent, type AgentRunResult } from "./travelAgent";

export type { BrokerPort } from "./port";
export {
  AgentSession,
  AuthorityRevokedError,
  HALTING_REASON_CODES,
  type ContextAsk,
  type SessionIdentity,
  type VisibleDecision,
  type VisibleDelegation,
} from "./session";
export { Trace, type TraceEntry } from "./trace";
export { runHotelAgent, type HotelRecommendation, type HotelSearchTask } from "./hotelAgent";
export { GOLDEN_TASK, nextWeekend, runTravelAgent, runRetryAfterRevoke, type AgentRunResult, type TravelTask } from "./travelAgent";
export {
  BOOKING_PAGE_URL,
  DEALS_PAGE_URL,
  MALICIOUS_BOOKING_PAGE,
  MALICIOUS_DEALS_PAGE,
  MALICIOUS_HOTEL_DESCRIPTION,
  MALICIOUS_PROVIDER_NOTICE,
  createEnvironment,
  goldenEnvironment,
  type AgentEnvironment,
  type HotelOffer,
  type InjectionScenario,
} from "./environment";

export { AnthropicLlmProvider, DEFAULT_PLANNER_MODEL, type AnthropicProviderOptions, type Effort, type LlmProvider, type PlannerRequest } from "./llm/provider";
export { FakeLlmProvider, type FakeScript, type FakeToolCall, type FakeTurn, type ObservedToolResult } from "./llm/fakeProvider";
export { PLANNER_SYSTEM_PROMPT, PLANNER_TOOLS, runLlmTravelAgent, type LlmPlannerOptions } from "./llm/planner";

export interface RunScenarioInput {
  mandate: TaskMandate;
  /** Broker-issued session for the mandate's root agent. */
  session: AgentSessionGrant;
  scenario?: "golden" | "retry";
  /** Which untrusted-content injection the world contains (default: SYSTEM OVERRIDE deals page). */
  injection?: InjectionScenario;
  clock?: () => Date;
}

/** Entry point used by the broker API: runs the scripted Travel Agent against the real broker path. */
export async function runAgentScenario(port: BrokerPort, input: RunScenarioInput): Promise<AgentRunResult> {
  const clock = input.clock ?? (() => new Date());
  const trace = new Trace();
  const session = new AgentSession(port, input.session, trace, {
    clock,
    environment: createEnvironment(input.injection ?? "deals_page"),
  });

  const result =
    input.scenario === "retry"
      ? await runRetryAfterRevoke(session, clock())
      : await runTravelAgent(
          session,
          {
            text: input.mandate.description || GOLDEN_TASK,
            destination: input.mandate.constraints.destination ?? "Singapore",
            budgetUsd: input.mandate.constraints.budgetUsd,
          },
          clock(),
        );
  return { ...result, trace: trace.entries };
}

/**
 * Runs the LLM planner against the real broker path. If the provider fails
 * before anything was booked, the deterministic scripted planner re-runs the
 * task (`planner: "scripted-fallback"`), so the demo never depends on the LLM.
 */
export async function runLlmScenario(
  port: BrokerPort,
  input: RunScenarioInput,
  provider: LlmProvider,
  options: { fallbackToScripted?: boolean } = {},
): Promise<AgentRunResult> {
  const clock = input.clock ?? (() => new Date());
  const trace = new Trace();
  const session = new AgentSession(port, input.session, trace, {
    clock,
    environment: createEnvironment(input.injection ?? "deals_page"),
  });
  const result = await runLlmTravelAgent(
    session,
    {
      text: input.mandate.description || GOLDEN_TASK,
      destination: input.mandate.constraints.destination ?? "Singapore",
      budgetUsd: input.mandate.constraints.budgetUsd,
    },
    { provider, now: clock() },
  );
  const llmRun: AgentRunResult = { ...result, scenario: input.scenario ?? "golden", trace: trace.entries };
  if (llmRun.status === "PLANNER_ERROR" && !llmRun.booking && options.fallbackToScripted !== false) {
    const scripted = await runAgentScenario(port, input);
    return { ...scripted, planner: "scripted-fallback", fallbackReason: llmRun.summary };
  }
  return llmRun;
}
