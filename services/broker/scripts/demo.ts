/**
 * Demo automation for the ContextCaps broker (Person 3 integration aid).
 *
 *   npm run demo:reset                 reset broker state (DEMO_MODE=true)
 *   npm run demo:seed                  reset + authorize the travel mandate; prints ids + root session
 *   npm run demo:golden-flow           walk the 9 golden scenes over real HTTP; exit 1 on any surprise
 *   npm run demo:golden-flow -- --local    same, against an in-process broker (no server needed)
 *
 * Target: BROKER_URL (default http://127.0.0.1:8787/api/v1).
 * Prints decisions and ids only — never private values.
 */
import { nextWeekend } from "@contextcaps/agent";
import { BOOKING_TOOL_ID, OPERATIONS } from "@contextcaps/policy";
import { AGENT_IDS, RESOURCES, type CreateMandateResponse } from "@contextcaps/shared-types";
import { createBrokerApp } from "../src/app";
import { silentLogger } from "../src/logger";
import { sequentialIds } from "../src/runtime";
import { Wallet } from "ethers";

type Json = Record<string, any>;

const DEFAULT_URL = "http://127.0.0.1:8787/api/v1";

async function main(): Promise<void> {
  const [command = "golden-flow", ...flags] = process.argv.slice(2);
  const local = flags.includes("--local");
  let baseUrl = process.env.BROKER_URL ?? DEFAULT_URL;
  let stop: (() => Promise<void>) | undefined;

  if (local) {
    const { server } = await createBrokerApp(
      { receiptKey: "demo-local-key", demoMode: true, corsOrigins: true, chainProvider: "mock" },
      { ids: sequentialIds(), logger: silentLogger },
    );
    const address = await server.listen({ port: 0, host: "127.0.0.1" });
    baseUrl = `${address}/api/v1`;
    stop = () => server.close();
  }

  const client = new BrokerClient(baseUrl);
  try {
    if (command === "reset") await reset(client);
    else if (command === "seed") await seed(client, true);
    else if (command === "golden-flow") await goldenFlow(client);
    else throw new Error(`Unknown command '${command}'. Use reset | seed | golden-flow.`);
  } finally {
    await stop?.();
  }
}

class BrokerClient {
  readonly baseUrl: string;
  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  async call(method: "GET" | "POST", path: string, body?: unknown, session?: string): Promise<{ status: number; json: Json }> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["content-type"] = "application/json";
    if (session) headers["x-contextcaps-session"] = session;
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new Error(`Broker not reachable at ${this.baseUrl}. Start it with 'npm run start:broker' or pass --local.`);
    }
    return { status: res.status, json: (await res.json()) as Json };
  }
}

async function reset(client: BrokerClient): Promise<void> {
  const res = await client.call("POST", "/demo/reset", {});
  if (res.status !== 200) throw new Error(`reset failed (${res.status}) — is DEMO_MODE=true?`);
  console.log("✓ broker state reset");
}

async function seed(client: BrokerClient, print: boolean): Promise<CreateMandateResponse> {
  await reset(client);
  const res = await client.call("POST", "/mandates", {
    principal: process.env.MONAD_PRIVATE_KEY ? new Wallet(process.env.MONAD_PRIVATE_KEY).address : "0xA11CE",
    description: "Book my Singapore trip next weekend under $700.",
    constraints: { budgetUsd: 700, destination: "Singapore" },
  });
  if (res.status !== 201) throw new Error(`mandate creation failed (${res.status})`);
  const created = res.json as CreateMandateResponse;
  if (print) {
    console.log(`✓ mandate     ${created.mandate.mandateId}`);
    console.log(`✓ capability  ${created.capability.capabilityId} (${created.capability.agentId}, expires ${created.capability.expiresAt})`);
    console.log(`✓ session     ${created.session.sessionId}   ← x-contextcaps-session header for agent calls`);
    console.log(`✓ chain tx    ${created.chain.txHash}`);
  }
  return created;
}

let failures = 0;

function expectStep(label: string, ok: boolean, detail: string): void {
  if (!ok) failures += 1;
  console.log(`${ok ? "✓" : "✗"} ${label.padEnd(44)} ${detail}`);
}

function decisionLine(d: Json): string {
  return `${d.decision} ${d.reasonCode}`;
}

async function goldenFlow(client: BrokerClient): Promise<void> {
  failures = 0;
  const m = await seed(client, false);
  const travel = m.session.sessionId;
  const { departureDate, returnDate } = nextWeekend(new Date());
  const ctx = (body: Json, session = travel) => client.call("POST", "/context/request", body, session).then((r) => r.json);
  expectStep("1 authorize task (mandate + root capability)", m.capability.status === "ACTIVE", `${m.capability.capabilityId} ACTIVE`);

  const raw = await ctx({ resource: RESOURCES.PASSPORT_RAW, operation: OPERATIONS.READ });
  expectStep("2 travel-agent → passport.raw", raw.reasonCode === "RAW_DISCLOSURE_FORBIDDEN", decisionLine(raw));

  const validity = await ctx({
    resource: RESOURCES.PASSPORT_VALIDITY,
    operation: OPERATIONS.VALID_FOR_TRIP,
    parameters: { destination: "Singapore", departureDate, returnDate },
  });
  expectStep("3 travel-agent → passport.validity", validity.decision === "DERIVE" && validity.result?.valid === true, `${decisionLine(validity)} valid=${validity.result?.valid}`);

  const window = { from: `${departureDate}T00:00:00Z`, to: `${returnDate}T23:59:59Z`, minHours: 24 };
  const calRaw = await ctx({ resource: RESOURCES.CALENDAR_RAW, operation: OPERATIONS.READ });
  expectStep("4a travel-agent → calendar.raw", calRaw.decision === "DENY", decisionLine(calRaw));
  const avail = await ctx({ resource: RESOURCES.CALENDAR_AVAILABILITY, operation: OPERATIONS.AVAILABLE_WINDOW, parameters: window });
  expectStep("4b travel-agent → calendar.availability", avail.decision === "DERIVE" && avail.result?.available === true, `${decisionLine(avail)} ${avail.result?.start ?? ""}`);

  const salary = await ctx({ resource: RESOURCES.SALARY_RAW, operation: OPERATIONS.READ });
  expectStep("5 injected 'SYSTEM OVERRIDE' → salary.raw", salary.reasonCode === "OUT_OF_SCOPE", decisionLine(salary));

  const delegation = await client.call(
    "POST",
    "/delegations",
    {
      childAgentId: AGENT_IDS.HOTEL,
      permissions: [
        { resource: RESOURCES.CALENDAR_AVAILABILITY, allowedModes: ["DERIVE"], delegable: false },
        { resource: RESOURCES.TRAVEL_HOTEL_PREFERENCES, allowedModes: ["SELECT"], delegable: false },
      ],
    },
    travel,
  );
  const hotel = delegation.json.childSession?.sessionId as string | undefined;
  expectStep(
    "6a delegate hotel search → hotel-agent",
    delegation.status === 201 && !!hotel,
    `${delegation.json.capability?.capabilityId ?? delegation.json.reasonCode} [${(delegation.json.capability?.permissions ?? []).map((p: Json) => p.resource).join(", ")}]`,
  );
  if (hotel) {
    const prefs = await ctx({ resource: RESOURCES.TRAVEL_HOTEL_PREFERENCES, operation: OPERATIONS.SELECT }, hotel);
    expectStep("6b hotel-agent → travel.hotel_preferences", prefs.decision === "SELECT", `${decisionLine(prefs)} fields=${Object.keys(prefs.result ?? {}).join(",")}`);
    const hotelPassport = await ctx({ resource: RESOURCES.PASSPORT_VALIDITY, operation: OPERATIONS.VALID_FOR_TRIP, parameters: { destination: "Singapore", departureDate, returnDate } }, hotel);
    expectStep("6c hotel-agent → passport.validity", hotelPassport.decision === "DENY", decisionLine(hotelPassport));
  }
  const badDelegation = await client.call(
    "POST",
    "/delegations",
    { childAgentId: AGENT_IDS.HOTEL, permissions: [{ resource: RESOURCES.PASSPORT_VALIDITY, allowedModes: ["DERIVE"], delegable: false }] },
    travel,
  );
  expectStep("6d delegate passport authority", badDelegation.status === 403, `${badDelegation.status} ${badDelegation.json.reasonCode}`);

  const handle = async (resource: string) =>
    (await ctx({ resource, operation: OPERATIONS.ISSUE_HANDLE, requestedMode: "TOOL_BOUND", audience: BOOKING_TOOL_ID })).result?.handle as string;
  const identityHandle = await handle(RESOURCES.PROFILE_LEGAL_NAME);
  const paymentHandle = await handle(RESOURCES.PAYMENT_HANDLE);
  const booking = await client.call(
    "POST",
    `/tools/${BOOKING_TOOL_ID}/invoke`,
    { arguments: { offerId: "SG-HTL-MRNA-02", checkIn: departureDate, checkOut: returnDate, amountUsd: 189, identityHandle, paymentHandle } },
    travel,
  );
  expectStep(
    "7 tool-bound checkout (handles only)",
    booking.json.result?.bookingStatus === "CONFIRMED",
    `${booking.json.decision} ${booking.json.result?.bookingStatus ?? booking.json.reasonCode} ${booking.json.result?.reference ?? ""} handle=${identityHandle?.slice(0, 8)}…`,
  );

  const revoke = await client.call("POST", `/capabilities/${m.capability.capabilityId}/revoke`, {});
  expectStep("8 user revokes root capability", revoke.json.capability?.status === "REVOKED", `${revoke.json.capability?.status} tx=${String(revoke.json.chain?.revocationTxHash).slice(0, 12)}…`);

  const retry = await ctx({ resource: RESOURCES.CALENDAR_AVAILABILITY, operation: OPERATIONS.AVAILABLE_WINDOW, parameters: window });
  expectStep("9 travel-agent retries", retry.reasonCode === "CAPABILITY_REVOKED", decisionLine(retry));
  if (hotel) {
    const childRetry = await ctx({ resource: RESOURCES.CALENDAR_AVAILABILITY, operation: OPERATIONS.AVAILABLE_WINDOW, parameters: window }, hotel);
    expectStep("9b hotel-agent retries (child of revoked)", childRetry.reasonCode === "CAPABILITY_REVOKED", decisionLine(childRetry));
  }

  const audit = await client.call("GET", `/audit?mandateId=${m.mandate.mandateId}`);
  console.log(`  audit: ${audit.json.entries.length} receipts, ${audit.json.lifecycle.length} lifecycle events (GET /audit?mandateId=${m.mandate.mandateId})`);
  if (failures > 0) {
    console.error(`✗ golden flow: ${failures} unexpected result(s)`);
    process.exitCode = 1;
  } else {
    console.log("✓ golden flow complete");
  }
}

main().catch((error: unknown) => {
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
