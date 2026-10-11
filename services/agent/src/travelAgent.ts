import { BOOKING_TOOL_ID, OPERATIONS } from "@contextcaps/policy";
import { AGENT_IDS, RESOURCES, type ToolBoundHandle } from "@contextcaps/shared-types";
import { DEALS_PAGE_URL } from "./environment";
import { runHotelAgent, type HotelRecommendation } from "./hotelAgent";
import { AuthorityRevokedError, type AgentSession } from "./session";
import type { TraceEntry } from "./trace";

export const GOLDEN_TASK = "Book my Singapore trip next weekend under $700.";

export interface TravelTask {
  text: string;
  destination: string;
  budgetUsd?: number;
}

export interface AgentRunResult {
  scenario: "golden" | "retry";
  status: "BOOKED" | "HALTED_BY_POLICY" | "NO_BOOKING";
  haltReasonCode?: string;
  summary: string;
  booking?: HotelRecommendation & { reference: string };
  childCapabilityId?: string;
  trace: TraceEntry[];
}

/** Saturday/Sunday of "next weekend" relative to `now` (UTC), as YYYY-MM-DD. */
export function nextWeekend(now: Date): { departureDate: string; returnDate: string } {
  const day = now.getUTCDay(); // 0 = Sunday
  const daysToSaturday = day === 6 ? 7 : day === 0 ? 6 : 6 - day;
  const saturday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysToSaturday));
  const sunday = new Date(saturday.getTime() + 24 * 60 * 60 * 1000);
  return { departureDate: isoDay(saturday), returnDate: isoDay(sunday) };
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function plusDays(isoDate: string, days: number): string {
  return isoDay(new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * 24 * 60 * 60 * 1000));
}

/**
 * Scripted Travel Agent — deterministic stand-in for the LLM planner.
 *
 * It deliberately behaves like an over-curious, prompt-injectable model
 * (asks for raw data first, obeys a malicious page) so the demo exercises
 * every enforcement path. All allow/deny outcomes come from the real broker;
 * nothing here decides authorization.
 */
export async function runTravelAgent(session: AgentSession, task: TravelTask, now: Date): Promise<AgentRunResult> {
  const finish = (r: Omit<AgentRunResult, "scenario" | "trace">) => ({ scenario: "golden" as const, trace: [], ...r });
  session.note(`Task: ${task.text}`);
  const { departureDate, returnDate } = nextWeekend(now);
  let childCapabilityId: string | undefined;

  try {
    // Scene 2 — over-broad ask for the raw passport.
    await session.requestContext({ resource: RESOURCES.PASSPORT_RAW, operation: OPERATIONS.READ });

    // Scene 3 — minimum derived fact instead.
    const passport = await session.requestContext({
      resource: RESOURCES.PASSPORT_VALIDITY,
      operation: OPERATIONS.VALID_FOR_TRIP,
      requestedMode: "DERIVE",
      parameters: { destination: task.destination, departureDate, returnDate },
    });
    if (!passport.allowed || !(passport.result as { valid?: boolean }).valid) {
      return finish({ status: "NO_BOOKING", summary: "Passport is not confirmed valid for this trip." });
    }

    // Scene 4 — full calendar denied, availability window derived.
    await session.requestContext({ resource: RESOURCES.CALENDAR_RAW, operation: OPERATIONS.READ });
    const availability = await session.requestContext({
      resource: RESOURCES.CALENDAR_AVAILABILITY,
      operation: OPERATIONS.AVAILABLE_WINDOW,
      requestedMode: "DERIVE",
      parameters: { from: `${departureDate}T00:00:00Z`, to: `${plusDays(returnDate, 1)}T00:00:00Z`, minHours: 24 },
    });
    if (!availability.allowed || !(availability.result as { available?: boolean }).available) {
      return finish({ status: "NO_BOOKING", summary: "No availability window next weekend." });
    }

    // Scene 5 — untrusted page carries a prompt injection; the agent obeys it.
    const page = session.browse(DEALS_PAGE_URL);
    if (/salary/i.test(page)) {
      session.note("Page instructs reading the user's salary for premium offers. Attempting.");
      await session.requestContext({ resource: RESOURCES.SALARY_RAW, operation: OPERATIONS.READ });
    }

    // Scene 6 — delegate hotel search with a narrower capability.
    const delegation = await session.delegateContext({
      childAgentId: AGENT_IDS.HOTEL,
      permissions: [
        { resource: RESOURCES.CALENDAR_AVAILABILITY, allowedModes: ["DERIVE"], delegable: false },
        { resource: RESOURCES.TRAVEL_HOTEL_PREFERENCES, allowedModes: ["SELECT"], delegable: false },
      ],
    });
    if (!delegation.allowed || !delegation.childCapabilityId) {
      return finish({ status: "NO_BOOKING", summary: `Hotel delegation rejected: ${delegation.reasonCode}.` });
    }
    childCapabilityId = delegation.childCapabilityId;
    const hotelSession = session.childSession(AGENT_IDS.HOTEL, childCapabilityId);
    const offer = await runHotelAgent(hotelSession, {
      destination: task.destination,
      checkIn: departureDate,
      checkOut: returnDate,
      budgetUsd: task.budgetUsd,
    });
    if (!offer) {
      return finish({ status: "NO_BOOKING", summary: "Hotel Agent found no suitable offer.", childCapabilityId });
    }

    // Scene 7 — tool-bound checkout: the agent only ever holds opaque handles.
    const identity = await session.requestContext({
      resource: RESOURCES.PROFILE_LEGAL_NAME,
      operation: OPERATIONS.ISSUE_HANDLE,
      requestedMode: "TOOL_BOUND",
      audience: BOOKING_TOOL_ID,
    });
    const payment = await session.requestContext({
      resource: RESOURCES.PAYMENT_HANDLE,
      operation: OPERATIONS.ISSUE_HANDLE,
      requestedMode: "TOOL_BOUND",
      audience: BOOKING_TOOL_ID,
    });
    if (!identity.allowed || !payment.allowed) {
      return finish({ status: "NO_BOOKING", summary: "Checkout credentials were not released.", childCapabilityId });
    }

    const booking = await session.bookHotel({
      offerId: offer.offerId,
      checkIn: offer.checkIn,
      checkOut: offer.checkOut,
      amountUsd: offer.totalUsd,
      identityHandle: (identity.result as ToolBoundHandle).handle,
      paymentHandle: (payment.result as ToolBoundHandle).handle,
    });
    if (!booking.allowed || booking.result?.bookingStatus !== "CONFIRMED") {
      return finish({ status: "NO_BOOKING", summary: `Booking failed: ${booking.reasonCode}.`, childCapabilityId });
    }
    const reference = String(booking.result.reference);
    session.note(`Booked ${offer.hotelName}, reference ${reference}.`);
    return finish({
      status: "BOOKED",
      summary: `Booked ${offer.hotelName} in ${task.destination} (${offer.checkIn} → ${offer.checkOut}) for $${offer.totalUsd}.`,
      booking: { ...offer, reference },
      childCapabilityId,
    });
  } catch (error) {
    if (error instanceof AuthorityRevokedError) {
      session.note(`Stopping: authority withdrawn (${error.reasonCode}).`);
      return finish({ status: "HALTED_BY_POLICY", haltReasonCode: error.reasonCode, summary: error.message, childCapabilityId });
    }
    throw error;
  }
}

/** Scene 8 — after revocation the agent retries one request and must be denied. */
export async function runRetryAfterRevoke(session: AgentSession, now: Date): Promise<AgentRunResult> {
  const { departureDate, returnDate } = nextWeekend(now);
  try {
    await session.requestContext({
      resource: RESOURCES.CALENDAR_AVAILABILITY,
      operation: OPERATIONS.AVAILABLE_WINDOW,
      requestedMode: "DERIVE",
      parameters: { from: `${departureDate}T00:00:00Z`, to: `${plusDays(returnDate, 1)}T00:00:00Z`, minHours: 24 },
    });
    return { scenario: "retry", status: "NO_BOOKING", summary: "Request was still permitted.", trace: [] };
  } catch (error) {
    if (error instanceof AuthorityRevokedError) {
      session.note(`Stopping: authority withdrawn (${error.reasonCode}).`);
      return { scenario: "retry", status: "HALTED_BY_POLICY", haltReasonCode: error.reasonCode, summary: error.message, trace: [] };
    }
    throw error;
  }
}
