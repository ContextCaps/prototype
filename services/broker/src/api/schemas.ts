import { DISCLOSURE_MODES, type DisclosureMode } from "@contextcaps/shared-types";
import { z } from "zod";

const id = z.string().min(1).max(128);
const isoDate = z.string().min(1).max(64).refine((v) => !Number.isNaN(Date.parse(v)), "must be an ISO date");
const mode = z.enum(DISCLOSURE_MODES as [DisclosureMode, ...DisclosureMode[]]);

export const contextRequestSchema = z.object({
  requestId: id,
  mandateId: id,
  capabilityId: id,
  agentId: id,
  purpose: z.string().min(1).max(128),
  resource: z.string().min(1).max(128),
  operation: z.string().min(1).max(64),
  requestedMode: mode.optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
  audience: z.string().min(1).max(128).optional(),
  timestamp: z.string().min(1).max(64),
});

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

export const createDelegationSchema = z.object({
  mandateId: id,
  parentCapabilityId: id,
  parentAgentId: id,
  childAgentId: id,
  purpose: z.string().min(1).max(128),
  permissions: z.array(permissionSchema).min(1).max(16),
  expiresAt: isoDate.optional(),
  maxDelegationDepth: z.number().int().min(0).max(8).optional(),
});

export const toolInvocationSchema = z.object({
  requestId: id,
  mandateId: id,
  capabilityId: id,
  agentId: id,
  purpose: z.string().min(1).max(128),
  arguments: z.record(z.string(), z.unknown()),
});

export const agentRunSchema = z.object({
  mandateId: id,
  capabilityId: id.optional(),
  scenario: z.enum(["golden", "retry"]).optional(),
});

export const auditQuerySchema = z.object({ mandateId: id });
