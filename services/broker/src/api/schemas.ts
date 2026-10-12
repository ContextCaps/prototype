import { DISCLOSURE_MODES, type DisclosureMode } from "@contextcaps/shared-types";
import { z } from "zod";

const id = z.string().min(1).max(128);
const isoDate = z.string().min(1).max(64).refine((v) => !Number.isNaN(Date.parse(v)), "must be an ISO date");
const mode = z.enum(DISCLOSURE_MODES as [DisclosureMode, ...DisclosureMode[]]);

export const createMandateSchema = z.object({
  principal: z.string().min(1).max(128),
  description: z.string().min(1).max(500),
  purpose: z.string().min(1).max(128).optional(),
  constraints: z.object({
    budgetUsd: z.number().positive().optional(),
    destination: z.string().min(1).max(128).optional(),
    validFrom: isoDate.optional(),
    validUntil: isoDate.optional(),
  }),
});

const permissionSchema = z.object({
  resource: z.string().min(1).max(128),
  allowedModes: z.array(mode).min(1),
  allowedOperations: z.array(z.string().min(1).max(64)).optional(),
  allowedAudience: z.array(z.string().min(1).max(128)).optional(),
  delegable: z.boolean(),
});

/**
 * Identity fields a session-bound body MAY echo (backward compatibility with the
 * §6 ContextRequest shape). The broker never trusts them: a value that differs
 * from the session is denied.
 */
const identityEcho = {
  mandateId: id.optional(),
  capabilityId: id.optional(),
  agentId: id.optional(),
};

export const sessionContextRequestSchema = z.object({
  ...identityEcho,
  requestId: id.optional(),
  purpose: z.string().min(1).max(128).optional(),
  resource: z.string().min(1).max(128),
  operation: z.string().min(1).max(64),
  requestedMode: mode.optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
  audience: z.string().min(1).max(128).optional(),
  timestamp: z.string().min(1).max(64).optional(),
});

export const sessionDelegationSchema = z.object({
  ...identityEcho,
  parentCapabilityId: id.optional(),
  parentAgentId: id.optional(),
  childAgentId: id,
  purpose: z.string().min(1).max(128).optional(),
  permissions: z.array(permissionSchema).min(1).max(16),
  expiresAt: isoDate.optional(),
  maxDelegationDepth: z.number().int().min(0).max(8).optional(),
});

export const sessionToolInvocationSchema = z.object({
  ...identityEcho,
  requestId: id.optional(),
  purpose: z.string().min(1).max(128).optional(),
  arguments: z.record(z.string(), z.unknown()),
});

export const agentRunSchema = z.object({
  mandateId: id,
  scenario: z.enum(["golden", "retry"]).optional(),
  planner: z.enum(["scripted", "llm"]).optional(),
  injection: z.enum(["deals_page", "hotel_description", "tool_response", "booking_page"]).optional(),
});

export const auditQuerySchema = z.object({ mandateId: id });

const txHash = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "must be a 32-byte hex transaction hash");

export const confirmWalletTxSchema = z.object({ txHash });

/** Server mode: empty body. Wallet mode: the hash of the principal's revocation tx. */
export const revokeSchema = z.object({ txHash: txHash.optional() }).optional();
