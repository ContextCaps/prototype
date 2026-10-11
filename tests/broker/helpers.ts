import { GOLDEN_TASK } from "@contextcaps/agent";
import {
  ContextBroker,
  createLogger,
  MockBookingConnector,
  MockCapabilityStateProvider,
  sequentialIds,
  type ToolConnector,
} from "@contextcaps/broker";
import { BOOKING_TOOL_ID, OPERATIONS } from "@contextcaps/policy";
import { AGENT_IDS, RESOURCES, type ContextRequest, type CreateMandateResponse } from "@contextcaps/shared-types";
import { ContextVault, SEEDED_SECRET_VALUES } from "@contextcaps/vault";

/** Monday 2026-10-12 09:00 UTC — "next weekend" is 2026-10-17/18. */
export const NOW = new Date("2026-10-12T09:00:00Z");
export const MANDATE_VALID_UNTIL = "2026-10-20T00:00:00Z";
export const TRIP = { destination: "Singapore", departureDate: "2026-10-17", returnDate: "2026-10-18" };

export function makeHarness(options: { extraConnectors?: ToolConnector[] } = {}) {
  let now = NOW;
  const clock = () => now;
  const provider = new MockCapabilityStateProvider(clock);
  const logLines: string[] = [];
  const vault = new ContextVault();
  const booking = new MockBookingConnector();
  const broker = new ContextBroker({
    vault,
    provider,
    connectors: [booking, ...(options.extraConnectors ?? [])],
    receiptKey: "test-receipt-key",
    clock,
    ids: sequentialIds(),
    logger: createLogger((line) => logLines.push(line)),
  });
  let requestCounter = 0;

  return {
    broker,
    provider,
    vault,
    booking,
    logLines,
    clock,
    setNow(date: Date) {
      now = date;
    },
    createTravelMandate(): Promise<CreateMandateResponse> {
      return broker.createMandate({
        principal: "0xA11CE",
        description: GOLDEN_TASK,
        constraints: { budgetUsd: 700, destination: "Singapore", validUntil: MANDATE_VALID_UNTIL },
      });
    },
    request(mandate: CreateMandateResponse, overrides: Partial<ContextRequest>): ContextRequest {
      requestCounter += 1;
      return {
        requestId: `req_test_${requestCounter}`,
        mandateId: mandate.mandate.mandateId,
        capabilityId: mandate.capability.capabilityId,
        agentId: AGENT_IDS.TRAVEL,
        purpose: mandate.mandate.purpose,
        resource: RESOURCES.PASSPORT_VALIDITY,
        operation: OPERATIONS.VALID_FOR_TRIP,
        timestamp: clock().toISOString(),
        ...overrides,
      };
    },
  };
}

export type Harness = ReturnType<typeof makeHarness>;

export const passportValidityAsk = {
  resource: RESOURCES.PASSPORT_VALIDITY,
  operation: OPERATIONS.VALID_FOR_TRIP,
  requestedMode: "DERIVE" as const,
  parameters: { ...TRIP },
};

export const availabilityAsk = {
  resource: RESOURCES.CALENDAR_AVAILABILITY,
  operation: OPERATIONS.AVAILABLE_WINDOW,
  requestedMode: "DERIVE" as const,
  parameters: { from: "2026-10-17T00:00:00Z", to: "2026-10-19T00:00:00Z", minHours: 24 },
};

export const toolBoundAsk = (resource: string) => ({
  resource,
  operation: OPERATIONS.ISSUE_HANDLE,
  requestedMode: "TOOL_BOUND" as const,
  audience: BOOKING_TOOL_ID,
});

/** Asserts none of the seeded private values appear in `value` once serialized. */
export function findLeakedSecrets(value: unknown): string[] {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  const leaked = SEEDED_SECRET_VALUES.filter((secret) => serialized.includes(secret));
  if (/"monthly"\s*:/.test(serialized) || serialized.includes('"passportNumber"')) leaked.push("<raw record keys>");
  return leaked;
}
