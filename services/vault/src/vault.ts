import { RESOURCES } from "@contextcaps/shared-types";
import { calendarAvailableWindow } from "./derivations/calendar";
import { DerivationError } from "./derivations/errors";
import { passportValidForTrip } from "./derivations/passport";
import { createSeed, type VaultSeed } from "./fixtures";

/** Secret material handed only to an approved tool connector — never to an agent. */
export type ToolSecret =
  | { kind: "legal_name"; legalName: string }
  | { kind: "payment"; provider: string; token: string };

/**
 * Context Vault.
 *
 * Raw records are held in a private field and there is deliberately no
 * getter for them. Callers can only obtain:
 *  - derived facts (`derive`),
 *  - explicitly listed fields (`select`),
 *  - tool-bound secrets (`resolveToolSecret`) — used only by the broker's tool gateway.
 *
 * Authorization is NOT performed here; the broker must call the policy engine first.
 */
export class ContextVault {
  #data: VaultSeed;

  constructor(seed: VaultSeed = createSeed()) {
    this.#data = structuredClone(seed);
  }

  reset(seed: VaultSeed = createSeed()): void {
    this.#data = structuredClone(seed);
  }

  derive(resource: string, parameters: Record<string, unknown>): unknown {
    switch (resource) {
      case RESOURCES.PASSPORT_VALIDITY:
        return passportValidForTrip(
          this.#data.passport,
          parameters.destination,
          parameters.departureDate,
          parameters.returnDate,
        );
      case RESOURCES.CALENDAR_AVAILABILITY:
        return calendarAvailableWindow(this.#data.calendar, {
          from: parameters.from,
          to: parameters.to,
          minHours: parameters.minHours,
        });
      default:
        throw new DerivationError("NO_DERIVATION", "resource has no derivation");
    }
  }

  select(resource: string, fields: readonly string[]): Record<string, unknown> {
    const source = this.#selectable(resource);
    const out: Record<string, unknown> = {};
    for (const field of fields) {
      if (Object.prototype.hasOwnProperty.call(source, field)) {
        out[field] = source[field];
      }
    }
    return out;
  }

  resolveToolSecret(resource: string): ToolSecret {
    switch (resource) {
      case RESOURCES.PROFILE_LEGAL_NAME:
        return { kind: "legal_name", legalName: this.#data.profile.legalName };
      case RESOURCES.PAYMENT_HANDLE:
        return { kind: "payment", provider: this.#data.payment.provider, token: this.#data.payment.token };
      default:
        throw new DerivationError("NO_TOOL_SECRET", "resource has no tool-bound secret");
    }
  }

  #selectable(resource: string): Record<string, unknown> {
    switch (resource) {
      case RESOURCES.TRAVEL_HOTEL_PREFERENCES:
        return this.#data.travelPreferences.hotel;
      default:
        throw new DerivationError("NO_SELECTION", "resource is not selectable");
    }
  }

  // Guard against accidental serialization/logging of the vault object.
  toJSON(): string {
    return "[ContextVault]";
  }

  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return "[ContextVault]";
  }
}
