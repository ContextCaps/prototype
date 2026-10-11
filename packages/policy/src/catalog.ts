import { RESOURCES, type DisclosureMode } from "@contextcaps/shared-types";
import { z } from "zod";

/** Mock booking connector — the only approved TOOL_BOUND audience in the MVP. */
export const BOOKING_TOOL_ID = "demo-booking-connector";

export const OPERATIONS = {
  READ: "read",
  VALID_FOR_TRIP: "valid_for_trip",
  AVAILABLE_WINDOW: "available_window",
  SELECT: "select",
  ISSUE_HANDLE: "issue_handle",
} as const;

/**
 * Server-side description of what each resource *can* be disclosed as.
 * A capability can only narrow this; it can never widen it.
 */
export interface ResourceSpec {
  resource: string;
  /** Prefix before the first dot, e.g. "passport". */
  family: string;
  /** Raw resources are never disclosable, regardless of capability contents. */
  raw: boolean;
  /** Disclosure modes the system can serve for this resource. First entry is the default. */
  modes: DisclosureMode[];
  operations: string[];
  /** SELECT only: the approved field allowlist. */
  selectableFields?: string[];
  /** TOOL_BOUND resources require an audience (the target tool). */
  requiresAudience?: boolean;
  /** Validates `ContextRequest.parameters` once the request is otherwise authorized. */
  parameters?: z.ZodType<Record<string, unknown>>;
  /** Parameters that must equal a mandate constraint (prevents off-task probing). */
  mandateBoundParams?: Array<{ param: string; constraint: "destination" }>;
}

const isoDate = z.string().min(1).refine((v) => !Number.isNaN(Date.parse(v)), "must be an ISO date");

function rawSpec(resource: string): ResourceSpec {
  return { resource, family: familyOf(resource), raw: true, modes: [], operations: [OPERATIONS.READ] };
}

export const RESOURCE_CATALOG: Readonly<Record<string, ResourceSpec>> = {
  [RESOURCES.PROFILE_LEGAL_NAME]: {
    resource: RESOURCES.PROFILE_LEGAL_NAME,
    family: "profile",
    raw: false,
    modes: ["TOOL_BOUND"],
    operations: [OPERATIONS.ISSUE_HANDLE],
    requiresAudience: true,
  },
  [RESOURCES.PASSPORT_RAW]: rawSpec(RESOURCES.PASSPORT_RAW),
  [RESOURCES.PASSPORT_VALIDITY]: {
    resource: RESOURCES.PASSPORT_VALIDITY,
    family: "passport",
    raw: false,
    modes: ["DERIVE"],
    operations: [OPERATIONS.VALID_FOR_TRIP],
    parameters: z.object({
      destination: z.string().min(1),
      departureDate: isoDate,
      returnDate: isoDate,
    }),
    mandateBoundParams: [{ param: "destination", constraint: "destination" }],
  },
  [RESOURCES.CALENDAR_RAW]: rawSpec(RESOURCES.CALENDAR_RAW),
  [RESOURCES.CALENDAR_AVAILABILITY]: {
    resource: RESOURCES.CALENDAR_AVAILABILITY,
    family: "calendar",
    raw: false,
    modes: ["DERIVE"],
    operations: [OPERATIONS.AVAILABLE_WINDOW],
    parameters: z.object({
      from: isoDate,
      to: isoDate,
      minHours: z.number().positive().optional(),
    }),
  },
  [RESOURCES.TRAVEL_HOTEL_PREFERENCES]: {
    resource: RESOURCES.TRAVEL_HOTEL_PREFERENCES,
    family: "travel",
    raw: false,
    modes: ["SELECT"],
    operations: [OPERATIONS.SELECT],
    selectableFields: ["roomType", "bedType", "areaPreference"],
    parameters: z.object({ fields: z.array(z.string().min(1)).min(1).optional() }),
  },
  [RESOURCES.SALARY_RAW]: rawSpec(RESOURCES.SALARY_RAW),
  [RESOURCES.PAYMENT_RAW]: rawSpec(RESOURCES.PAYMENT_RAW),
  [RESOURCES.PAYMENT_HANDLE]: {
    resource: RESOURCES.PAYMENT_HANDLE,
    family: "payment",
    raw: false,
    modes: ["TOOL_BOUND"],
    operations: [OPERATIONS.ISSUE_HANDLE],
    requiresAudience: true,
  },
};

export function familyOf(resource: string): string {
  const dot = resource.indexOf(".");
  return dot === -1 ? resource : resource.slice(0, dot);
}

export function getResourceSpec(resource: string): ResourceSpec | undefined {
  return Object.prototype.hasOwnProperty.call(RESOURCE_CATALOG, resource) ? RESOURCE_CATALOG[resource] : undefined;
}
