import { AGENT_IDS, RESOURCES, type AgentId, type ContextPermission } from "@contextcaps/shared-types";
import { BOOKING_TOOL_ID, OPERATIONS } from "./catalog";

export const PURPOSES = {
  TRAVEL_BOOKING: "travel-booking",
} as const;

export interface CapabilityTemplate {
  purpose: string;
  rootAgentId: AgentId;
  maxDelegationDepth: number;
  permissions: ContextPermission[];
}

/** Root travel capability — docs/02_SECURITY_AND_DEMO_SPEC.md §5. */
const TRAVEL_BOOKING_TEMPLATE: CapabilityTemplate = {
  purpose: PURPOSES.TRAVEL_BOOKING,
  rootAgentId: AGENT_IDS.TRAVEL,
  maxDelegationDepth: 1,
  permissions: [
    {
      resource: RESOURCES.PASSPORT_VALIDITY,
      allowedModes: ["DERIVE"],
      allowedOperations: [OPERATIONS.VALID_FOR_TRIP],
      delegable: false,
    },
    {
      resource: RESOURCES.CALENDAR_AVAILABILITY,
      allowedModes: ["DERIVE"],
      allowedOperations: [OPERATIONS.AVAILABLE_WINDOW],
      delegable: true,
    },
    {
      resource: RESOURCES.TRAVEL_HOTEL_PREFERENCES,
      allowedModes: ["SELECT"],
      allowedOperations: [OPERATIONS.SELECT],
      delegable: true,
    },
    {
      resource: RESOURCES.PROFILE_LEGAL_NAME,
      allowedModes: ["TOOL_BOUND"],
      allowedOperations: [OPERATIONS.ISSUE_HANDLE],
      allowedAudience: [BOOKING_TOOL_ID],
      delegable: false,
    },
    {
      resource: RESOURCES.PAYMENT_HANDLE,
      allowedModes: ["TOOL_BOUND"],
      allowedOperations: [OPERATIONS.ISSUE_HANDLE],
      allowedAudience: [BOOKING_TOOL_ID],
      delegable: false,
    },
  ],
};

const TEMPLATES: Readonly<Record<string, CapabilityTemplate>> = {
  [PURPOSES.TRAVEL_BOOKING]: TRAVEL_BOOKING_TEMPLATE,
};

export function getCapabilityTemplate(purpose: string): CapabilityTemplate | undefined {
  const template = Object.prototype.hasOwnProperty.call(TEMPLATES, purpose) ? TEMPLATES[purpose] : undefined;
  return template ? structuredClone(template) : undefined;
}
