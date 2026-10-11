import { OPERATIONS } from "@contextcaps/policy";
import { RESOURCES } from "@contextcaps/shared-types";
import type { HotelOffer } from "./environment";
import type { AgentSession } from "./session";

/** Task parameters a parent passes to the Hotel Agent — non-sensitive only. */
export interface HotelSearchTask {
  destination: string;
  checkIn: string;
  checkOut: string;
  budgetUsd?: number;
}

export interface HotelRecommendation {
  offerId: string;
  hotelName: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  totalUsd: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Hotel Agent (child). It runs on a delegated capability that only covers
 * calendar.availability (DERIVE) and travel.hotel_preferences (SELECT).
 */
export async function runHotelAgent(session: AgentSession, task: HotelSearchTask): Promise<HotelRecommendation | undefined> {
  session.note(`Searching hotels in ${task.destination} for ${task.checkIn} → ${task.checkOut}.`);

  const availability = await session.requestContext({
    resource: RESOURCES.CALENDAR_AVAILABILITY,
    operation: OPERATIONS.AVAILABLE_WINDOW,
    parameters: { from: `${task.checkIn}T00:00:00Z`, to: `${task.checkOut}T23:59:59Z`, minHours: 24 },
  });
  if (!availability.allowed || !(availability.result as { available?: boolean }).available) {
    session.note("No confirmed availability window; not recommending a hotel.");
    return undefined;
  }

  const prefsDecision = await session.requestContext({
    resource: RESOURCES.TRAVEL_HOTEL_PREFERENCES,
    operation: OPERATIONS.SELECT,
    requestedMode: "SELECT",
  });
  const prefs = (prefsDecision.allowed ? prefsDecision.result : {}) as Partial<Record<"roomType" | "bedType" | "areaPreference", string>>;

  const nights = Math.max(1, Math.round((Date.parse(task.checkOut) - Date.parse(task.checkIn)) / DAY_MS));
  const offers = session.searchHotels(task.destination);
  const matching = offers
    .filter((o) => matches(o, prefs))
    .filter((o) => task.budgetUsd === undefined || o.pricePerNightUsd * nights <= task.budgetUsd)
    .sort((a, b) => a.pricePerNightUsd - b.pricePerNightUsd);

  const best = matching[0];
  if (!best) {
    session.note("No offer matches preferences within budget.");
    return undefined;
  }
  const recommendation: HotelRecommendation = {
    offerId: best.offerId,
    hotelName: best.hotelName,
    checkIn: task.checkIn,
    checkOut: task.checkOut,
    nights,
    totalUsd: best.pricePerNightUsd * nights,
  };
  session.note(`Recommending ${best.hotelName} (${best.offerId}) at $${recommendation.totalUsd} total.`);
  return recommendation;
}

function matches(offer: HotelOffer, prefs: Partial<Record<"roomType" | "bedType" | "areaPreference", string>>): boolean {
  return (
    (!prefs.areaPreference || offer.area === prefs.areaPreference) &&
    (!prefs.roomType || offer.roomType === prefs.roomType) &&
    (!prefs.bedType || offer.bedType === prefs.bedType)
  );
}
