import { DerivationError, parseInstant } from "./errors";

export interface PassportValidityResult {
  valid: boolean;
}

/** Entry rules: passport must remain valid this many months after arrival. */
const ENTRY_RULES: Record<string, { minMonthsAfterArrival: number }> = {
  SG: { minMonthsAfterArrival: 6 },
};

const DESTINATION_ALIASES: Record<string, string> = {
  sg: "SG",
  singapore: "SG",
};

export function normalizeDestination(destination: unknown): string | undefined {
  if (typeof destination !== "string") return undefined;
  return DESTINATION_ALIASES[destination.trim().toLowerCase()];
}

function addMonthsUtc(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  result.setUTCMonth(result.getUTCMonth() + months);
  return result;
}

/**
 * Derives a single boolean from the passport. The passport object never
 * leaves this function: no number, nationality, or expiry date is returned.
 */
export function passportValidForTrip(
  passport: { expiresAt: string },
  destination: unknown,
  departure: unknown,
  returnDate: unknown,
): PassportValidityResult {
  const country = normalizeDestination(destination);
  const rule = country ? ENTRY_RULES[country] : undefined;
  if (!rule) {
    throw new DerivationError("UNSUPPORTED_DESTINATION", "destination has no entry rule");
  }
  const departAt = parseInstant(departure, "departureDate");
  const returnAt = parseInstant(returnDate, "returnDate");
  if (returnAt.getTime() < departAt.getTime()) {
    throw new DerivationError("INVALID_PARAMETER", "returnDate is before departureDate");
  }

  const expiry = parseInstant(passport.expiresAt, "passport.expiresAt");
  const requiredUntil = addMonthsUtc(departAt, rule.minMonthsAfterArrival);
  const valid = expiry.getTime() >= requiredUntil.getTime() && expiry.getTime() >= returnAt.getTime();
  return { valid };
}
