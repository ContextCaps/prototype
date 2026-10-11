/**
 * Deterministic demo fixtures (docs/02_SECURITY_AND_DEMO_SPEC.md §4).
 * Test data only — never real personal data.
 *
 * One addition to the spec fixture: `travelPreferences.hotel.loyaltyMemberId`.
 * It exists so SELECT is observable: it is stored in the vault but is not an
 * approved field, so it must never be disclosed.
 */

export interface CalendarEvent {
  title: string;
  start: string;
  end: string;
}

export interface VaultSeed {
  profile: { legalName: string };
  passport: { passportNumber: string; nationality: string; expiresAt: string };
  calendar: CalendarEvent[];
  travelPreferences: {
    hotel: {
      roomType: string;
      bedType: string;
      areaPreference: string;
      loyaltyMemberId: string;
    };
  };
  salary: { monthly: number; currency: string };
  payment: { provider: string; token: string };
}

export function createSeed(): VaultSeed {
  return {
    profile: { legalName: "Alex Morgan" },
    passport: { passportNumber: "X1234567", nationality: "ID", expiresAt: "2028-07-01" },
    calendar: [
      { title: "Private Meeting", start: "2026-10-10T09:00:00Z", end: "2026-10-10T11:00:00Z" },
      { title: "Project Review", start: "2026-10-11T08:00:00Z", end: "2026-10-11T10:00:00Z" },
    ],
    travelPreferences: {
      hotel: {
        roomType: "non-smoking",
        bedType: "queen",
        areaPreference: "central",
        loyaltyMemberId: "HLT-88231-AM",
      },
    },
    salary: { monthly: 5000, currency: "USD" },
    payment: { provider: "demo-pay", token: "secret-demo-token" },
  };
}

/**
 * Seeded private values that must never appear in logs, LLM-visible traces,
 * receipts, or on-chain data. Used by leak-detection tests.
 */
export const SEEDED_SECRET_VALUES: readonly string[] = [
  "Alex Morgan",
  "X1234567",
  "2028-07-01",
  "Private Meeting",
  "Project Review",
  "HLT-88231-AM",
  "secret-demo-token",
];
