import { RESOURCES } from "@contextcaps/shared-types";
import { calendarAvailableWindow, ContextVault, createSeed, DerivationError, passportValidForTrip } from "@contextcaps/vault";
import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import { findLeakedSecrets } from "./helpers";

describe("Vault derivations", () => {
  const seed = createSeed();

  it("passportValidForTrip returns only { valid }", () => {
    const result = passportValidForTrip(seed.passport, "Singapore", "2026-10-17", "2026-10-18");
    expect(result).toEqual({ valid: true });
  });

  it("passport invalid when expiry is within 6 months of arrival (Singapore rule)", () => {
    expect(passportValidForTrip(seed.passport, "SG", "2028-03-01", "2028-03-05")).toEqual({ valid: false });
    expect(passportValidForTrip(seed.passport, "SG", "2027-12-31", "2028-01-02")).toEqual({ valid: true });
  });

  it("unsupported destination or bad dates raise DerivationError (no guess)", () => {
    expect(() => passportValidForTrip(seed.passport, "Atlantis", "2026-10-17", "2026-10-18")).toThrow(DerivationError);
    expect(() => passportValidForTrip(seed.passport, "SG", "nope", "2026-10-18")).toThrow(DerivationError);
    expect(() => passportValidForTrip(seed.passport, "SG", "2026-10-18", "2026-10-17")).toThrow(DerivationError);
  });

  it("calendarAvailableWindow returns a free window and no event details", () => {
    const result = calendarAvailableWindow(seed.calendar, { from: "2026-10-10T00:00:00Z", to: "2026-10-12T00:00:00Z", minHours: 12 });
    expect(result).toEqual({ available: true, start: "2026-10-10T11:00:00.000Z", end: "2026-10-11T08:00:00.000Z" });
    expect(findLeakedSecrets(result)).toEqual([]);
  });

  it("calendarAvailableWindow reports unavailable when busy", () => {
    expect(calendarAvailableWindow(seed.calendar, { from: "2026-10-10T09:00:00Z", to: "2026-10-10T11:00:00Z" })).toEqual({ available: false });
  });

  it("calendar range is bounded to prevent bulk extraction", () => {
    expect(() => calendarAvailableWindow(seed.calendar, { from: "2026-10-01T00:00:00Z", to: "2026-11-01T00:00:00Z" })).toThrow(/at most/);
  });
});

describe("ContextVault surface", () => {
  it("exposes no raw getters", () => {
    const vault = new ContextVault();
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(vault)).filter((m) => m !== "constructor");
    expect(methods.sort()).toEqual(["derive", "reset", "resolveToolSecret", "select", "toJSON"].sort());
  });

  it("cannot be leaked by serialization or inspection", () => {
    const vault = new ContextVault();
    expect(JSON.stringify({ vault })).toBe('{"vault":"[ContextVault]"}');
    expect(findLeakedSecrets(inspect(vault, { depth: 10 }))).toEqual([]);
  });

  it("select returns only requested fields that exist", () => {
    const vault = new ContextVault();
    expect(vault.select(RESOURCES.TRAVEL_HOTEL_PREFERENCES, ["roomType", "nonexistent"])).toEqual({ roomType: "non-smoking" });
  });

  it("raw resources have no derivation / selection path", () => {
    const vault = new ContextVault();
    expect(() => vault.derive(RESOURCES.PASSPORT_RAW, {})).toThrow(DerivationError);
    expect(() => vault.select(RESOURCES.SALARY_RAW, ["monthly"])).toThrow(DerivationError);
    expect(() => vault.resolveToolSecret(RESOURCES.SALARY_RAW)).toThrow(DerivationError);
  });
});
