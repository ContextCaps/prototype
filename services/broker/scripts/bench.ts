/**
 * Rough local latency baseline (informational, for the pitch — not a
 * production benchmark). In-process broker, mock trust layer, silent logger.
 *
 *   npm run bench:broker
 */
import { BOOKING_TOOL_ID, evaluateRequest, OPERATIONS } from "@contextcaps/policy";
import { RESOURCES, type SessionContextRequest } from "@contextcaps/shared-types";
import { ContextVault } from "@contextcaps/vault";
import { ContextBroker } from "../src/broker";
import { MockCapabilityStateProvider } from "../src/chain/mockProvider";
import { resolveContext } from "../src/lineage";
import { silentLogger } from "../src/logger";
import { sequentialIds } from "../src/runtime";
import { MockBookingConnector } from "../src/tools/bookingConnector";

const N = Number(process.env.BENCH_N ?? 2000);

function newBroker(): { broker: ContextBroker; provider: MockCapabilityStateProvider } {
  const provider = new MockCapabilityStateProvider();
  const broker = new ContextBroker({
    vault: new ContextVault(),
    provider,
    connectors: [new MockBookingConnector()],
    receiptKey: "bench",
    ids: sequentialIds(),
    logger: silentLogger,
  });
  return { broker, provider };
}

async function mandate(broker: ContextBroker) {
  return broker.createMandate({
    principal: "0xA11CE",
    description: "bench",
    constraints: { budgetUsd: 700, destination: "Singapore" },
  });
}

function stats(samples: number[]): string {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
  return `p50 ${at(0.5).toFixed(3)} ms   p95 ${at(0.95).toFixed(3)} ms   (n=${samples.length})`;
}

async function time(label: string, iterations: number, setup: () => Promise<() => Promise<unknown> | unknown>): Promise<void> {
  const samples: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const run = await setup();
    const t = performance.now();
    await run();
    samples.push(performance.now() - t);
  }
  console.log(`${label.padEnd(38)} ${stats(samples)}`);
}

async function main(): Promise<void> {
  const { broker, provider } = newBroker();
  const m = await mandate(broker);
  const s = m.session.sessionId;
  const trip = { destination: "Singapore", departureDate: "2026-11-14", returnDate: "2026-11-15" };
  const passportAsk: SessionContextRequest = {
    resource: RESOURCES.PASSPORT_VALIDITY,
    operation: OPERATIONS.VALID_FOR_TRIP,
    parameters: trip,
  };

  // Pure policy evaluation (no I/O): lineage resolved once up front.
  const ctx = await resolveContext(broker.store, provider, m.capability.capabilityId, m.mandate.mandateId, new Date());
  const request = {
    requestId: "r",
    mandateId: m.mandate.mandateId,
    capabilityId: m.capability.capabilityId,
    agentId: m.capability.agentId,
    purpose: m.capability.purpose,
    timestamp: new Date().toISOString(),
    ...passportAsk,
  };
  await time("policy evaluation (pure)", N, async () => () => evaluateRequest(request, ctx));

  await time("broker DENY (passport.raw)", N, async () => () =>
    broker.requestContextForSession(s, { resource: RESOURCES.PASSPORT_RAW, operation: OPERATIONS.READ }),
  );
  await time("broker DERIVE passport.validity (fresh)", Math.min(N, 500), async () => {
    const fresh = await mandate(broker); // new capability → first (uncached) query
    return () => broker.requestContextForSession(fresh.session.sessionId, passportAsk);
  });
  await time("broker DERIVE passport.validity (cached)", N, async () => () => broker.requestContextForSession(s, passportAsk));
  await time("broker SELECT hotel preferences", N, async () => () =>
    broker.requestContextForSession(s, { resource: RESOURCES.TRAVEL_HOTEL_PREFERENCES, operation: OPERATIONS.SELECT }),
  );
  await time("broker TOOL_BOUND issue handle", N, async () => () =>
    broker.requestContextForSession(s, {
      resource: RESOURCES.PAYMENT_HANDLE,
      operation: OPERATIONS.ISSUE_HANDLE,
      requestedMode: "TOOL_BOUND",
      audience: BOOKING_TOOL_ID,
    }),
  );
  console.log("\nMock trust layer, in-process, single thread. Real Monad reads add RPC latency per request.");
}

void main();
