import { BOOKING_TOOL_ID } from "@contextcaps/policy";
import { RESOURCES } from "@contextcaps/shared-types";
import type { ToolSecret } from "@contextcaps/vault";
import type { ToolConnector } from "./connector";

export interface BookingRecord {
  reference: string;
  offerId: string;
  checkIn: string;
  checkOut: string;
  amountUsd: number;
  guestName: string;
  paymentProvider: string;
  /** The real credential — this is the merchant side, outside LLM context. */
  paymentToken: string;
}

/**
 * Mock hotel booking connector (approved TOOL_BOUND audience).
 * It receives the real legal name and payment token from the gateway and
 * returns only a booking status and reference.
 */
export class MockBookingConnector implements ToolConnector {
  readonly toolId = BOOKING_TOOL_ID;
  readonly handleArguments = {
    identityHandle: RESOURCES.PROFILE_LEGAL_NAME,
    paymentHandle: RESOURCES.PAYMENT_HANDLE,
  };
  readonly outputFields = ["bookingStatus", "reference", "offerId", "checkIn", "checkOut", "amountUsd"] as const;
  /** Merchant-side ledger. Test/diagnostic access only — never returned through the API. */
  readonly bookings: BookingRecord[] = [];

  validate(args: Record<string, unknown>): string | undefined {
    if (typeof args.offerId !== "string" || args.offerId.length === 0) return "offerId is required";
    if (typeof args.checkIn !== "string" || Number.isNaN(Date.parse(args.checkIn))) return "checkIn must be a date";
    if (typeof args.checkOut !== "string" || Number.isNaN(Date.parse(args.checkOut))) return "checkOut must be a date";
    if (typeof args.amountUsd !== "number" || !(args.amountUsd > 0)) return "amountUsd must be positive";
    return undefined;
  }

  chargeUsd(args: Record<string, unknown>): number | undefined {
    return typeof args.amountUsd === "number" ? args.amountUsd : undefined;
  }

  async execute(args: Record<string, unknown>, secrets: Readonly<Record<string, ToolSecret>>): Promise<Record<string, unknown>> {
    const identity = secrets[RESOURCES.PROFILE_LEGAL_NAME];
    const payment = secrets[RESOURCES.PAYMENT_HANDLE];
    if (identity?.kind !== "legal_name" || payment?.kind !== "payment" || payment.token.length === 0) {
      throw new Error("booking credentials missing");
    }
    const reference = `CC-DEMO-${String(this.bookings.length + 1).padStart(3, "0")}`;
    this.bookings.push({
      reference,
      offerId: String(args.offerId),
      checkIn: String(args.checkIn),
      checkOut: String(args.checkOut),
      amountUsd: Number(args.amountUsd),
      guestName: identity.legalName,
      paymentProvider: payment.provider,
      paymentToken: payment.token,
    });
    return {
      bookingStatus: "CONFIRMED",
      reference,
      offerId: args.offerId,
      checkIn: args.checkIn,
      checkOut: args.checkOut,
      amountUsd: args.amountUsd,
    };
  }

  reset(): void {
    this.bookings.length = 0;
  }

  toJSON(): string {
    return `[MockBookingConnector ${this.toolId}]`;
  }
}
