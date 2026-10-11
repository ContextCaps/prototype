import type { TaskMandate } from "@contextcaps/shared-types";
import type { BrokerPort } from "./port";
import { AgentSession } from "./session";
import { Trace } from "./trace";
import { GOLDEN_TASK, runRetryAfterRevoke, runTravelAgent, type AgentRunResult } from "./travelAgent";

export type { BrokerPort } from "./port";
export { AgentSession, AuthorityRevokedError, HALTING_REASON_CODES, type ContextAsk, type VisibleDecision } from "./session";
export { Trace, type TraceEntry } from "./trace";
export { runHotelAgent, type HotelRecommendation, type HotelSearchTask } from "./hotelAgent";
export { GOLDEN_TASK, nextWeekend, runTravelAgent, runRetryAfterRevoke, type AgentRunResult, type TravelTask } from "./travelAgent";
export { DEALS_PAGE_URL, MALICIOUS_DEALS_PAGE } from "./environment";

export interface RunScenarioInput {
  mandate: TaskMandate;
  capabilityId: string;
  scenario?: "golden" | "retry";
  clock?: () => Date;
}

/** Entry point used by the broker API: runs the Travel Agent against the real broker path. */
export async function runAgentScenario(port: BrokerPort, input: RunScenarioInput): Promise<AgentRunResult> {
  const clock = input.clock ?? (() => new Date());
  const trace = new Trace();
  const session = new AgentSession(
    port,
    {
      agentId: input.mandate.rootAgentId,
      mandateId: input.mandate.mandateId,
      capabilityId: input.capabilityId,
      purpose: input.mandate.purpose,
    },
    trace,
    clock,
  );

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
