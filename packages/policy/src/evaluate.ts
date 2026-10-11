import type {
  CapabilityStatus,
  ContextCapability,
  ContextPermission,
  ContextRequest,
  DisclosureMode,
  ReasonCode,
  TaskMandate,
} from "@contextcaps/shared-types";
import { getResourceSpec, type ResourceSpec } from "./catalog";
import { computePolicyHash } from "./hash";

/** Capability state as resolved from the trust layer (Monad or mock) for one capability. */
export type ChainStatus = CapabilityStatus | "NOT_FOUND" | "UNAVAILABLE";

export interface CapabilityView {
  capability: ContextCapability;
  chainStatus: ChainStatus;
  chainPolicyHash?: string;
}

export interface EvaluationContext {
  /** The capability under evaluation first, then its ancestors up to the root. */
  lineage: CapabilityView[];
  mandate: TaskMandate | undefined;
  now: Date;
}

export interface Denial {
  allowed: false;
  decision: "DENY";
  reasonCode: ReasonCode;
  reason: string;
}

export interface Allowance {
  allowed: true;
  decision: Exclude<DisclosureMode, "DENY">;
  reasonCode: ReasonCode;
  reason: string;
  spec: ResourceSpec;
  permission: ContextPermission;
  parameters: Record<string, unknown>;
  /** SELECT only: the fields to release. */
  fields?: string[];
  /** TOOL_BOUND only: the tool the handle is bound to. */
  audience?: string;
}

export type PolicyVerdict = Denial | Allowance;

export function deny(reasonCode: ReasonCode, reason: string): Denial {
  return { allowed: false, decision: "DENY", reasonCode, reason };
}

export interface CapabilityBinding {
  mandateId: string;
  agentId: string;
  purpose: string;
}

/**
 * Validates that a capability is usable *right now* by this agent for this
 * purpose. Shared by context requests, tool invocations, and delegation.
 * Returns a Denial, or undefined when the capability is usable.
 */
export function evaluateCapabilityState(binding: CapabilityBinding, ctx: EvaluationContext): Denial | undefined {
  const self = ctx.lineage[0];
  if (!self) return deny("INVALID_CAPABILITY", "Capability not found.");

  for (const view of ctx.lineage) {
    const { capability } = view;
    if (view.chainStatus === "UNAVAILABLE") {
      return deny("INVALID_CAPABILITY", "Capability state could not be verified; failing closed.");
    }
    if (view.chainStatus === "NOT_FOUND") {
      return deny("INVALID_CAPABILITY", "Capability is not registered with the trust layer.");
    }
    if (view.chainPolicyHash !== undefined && view.chainPolicyHash !== capability.policyHash) {
      return deny("INVALID_CAPABILITY", "Capability policy hash does not match the registered policy.");
    }
    if (computePolicyHash(capability) !== capability.policyHash) {
      return deny("INVALID_CAPABILITY", "Capability record failed integrity check.");
    }
  }

  // Revocation anywhere in the lineage revokes the whole chain.
  for (const view of ctx.lineage) {
    if (view.chainStatus === "REVOKED" || view.capability.status === "REVOKED") {
      const own = view === self;
      return deny("CAPABILITY_REVOKED", own ? "Capability was revoked." : "A parent capability was revoked.");
    }
  }
  for (const view of ctx.lineage) {
    if (view.chainStatus === "COMPLETED" || view.capability.status === "COMPLETED") {
      return deny("INVALID_CAPABILITY", "Capability is already completed.");
    }
  }
  const nowMs = ctx.now.getTime();
  for (const view of ctx.lineage) {
    const { capability } = view;
    if (
      view.chainStatus === "EXPIRED" ||
      capability.status === "EXPIRED" ||
      nowMs >= Date.parse(capability.expiresAt)
    ) {
      return deny("CAPABILITY_EXPIRED", view === self ? "Capability has expired." : "A parent capability has expired.");
    }
    if (nowMs < Date.parse(capability.validFrom)) {
      return deny("INVALID_CAPABILITY", "Capability is not yet valid.");
    }
  }

  const mandate = ctx.mandate;
  if (!mandate || mandate.mandateId !== self.capability.mandateId || binding.mandateId !== mandate.mandateId) {
    return deny("INVALID_CAPABILITY", "Capability does not belong to this mandate.");
  }
  if (mandate.status === "REVOKED") return deny("CAPABILITY_REVOKED", "Mandate was revoked.");
  if (mandate.status !== "ACTIVE") return deny("INVALID_CAPABILITY", "Mandate is not active.");

  if (binding.agentId !== self.capability.agentId) {
    return deny("AGENT_MISMATCH", "Capability is bound to a different agent.");
  }
  if (binding.purpose !== self.capability.purpose) {
    return deny("PURPOSE_MISMATCH", "Request purpose does not match the authorized task purpose.");
  }
  return undefined;
}

const ALLOW_REASON: Record<Allowance["decision"], { code: ReasonCode; text: string }> = {
  DERIVE: { code: "ALLOW_DERIVED", text: "Released a derived fact instead of raw data." },
  SELECT: { code: "ALLOW_SELECTED", text: "Released only approved fields." },
  TOOL_BOUND: { code: "ALLOW_TOOL_BOUND", text: "Issued an opaque handle; the secret goes only to the approved tool." },
};

/**
 * Deterministic disclosure decision for one ContextRequest.
 * Same request + capability lineage + mandate + time ⇒ same verdict.
 * The LLM has no input into this function beyond the request it submitted.
 */
export function evaluateRequest(request: ContextRequest, ctx: EvaluationContext): PolicyVerdict {
  const stateDenial = evaluateCapabilityState(request, ctx);
  if (stateDenial) return stateDenial;
  const capability = ctx.lineage[0]!.capability;

  const spec = getResourceSpec(request.resource);
  const permission = capability.permissions.find((p) => p.resource === request.resource);

  if (spec?.raw) {
    const familyInScope = capability.permissions.some((p) => getResourceSpec(p.resource)?.family === spec.family);
    return familyInScope || permission
      ? deny("RAW_DISCLOSURE_FORBIDDEN", "Raw data is never released; request the minimum derived fact instead.")
      : deny("OUT_OF_SCOPE", "Resource is outside the authorized task scope.");
  }
  if (!spec || !permission) {
    return deny("OUT_OF_SCOPE", "Resource is outside the authorized task scope.");
  }

  if (!spec.operations.includes(request.operation)) {
    return deny("OUT_OF_SCOPE", `Operation is not supported for ${spec.resource}.`);
  }
  if (permission.allowedOperations && !permission.allowedOperations.includes(request.operation)) {
    return deny("OUT_OF_SCOPE", "Operation is not authorized by this capability.");
  }

  const mode = request.requestedMode ?? spec.modes[0];
  if (!mode || mode === "DENY" || !spec.modes.includes(mode) || !permission.allowedModes.includes(mode)) {
    return deny("MODE_NOT_ALLOWED", `Disclosure mode is not allowed for ${spec.resource}.`);
  }

  if (permission.allowedAudience) {
    if (!request.audience || !permission.allowedAudience.includes(request.audience)) {
      return deny("AUDIENCE_NOT_ALLOWED", "Audience is not approved for this resource.");
    }
  } else if (spec.requiresAudience && !request.audience) {
    return deny("AUDIENCE_NOT_ALLOWED", "A tool audience is required for tool-bound disclosure.");
  }

  const parameters = validateParameters(spec, request.parameters ?? {}, ctx.mandate!);
  if ("denial" in parameters) return parameters.denial;

  let fields: string[] | undefined;
  if (mode === "SELECT") {
    const approved = spec.selectableFields ?? [];
    const requested = (parameters.value.fields as string[] | undefined) ?? approved;
    const unapproved = requested.filter((f) => !approved.includes(f));
    if (unapproved.length > 0) {
      return deny("OUT_OF_SCOPE", "Requested fields are not approved for selective disclosure.");
    }
    fields = requested;
  }

  const allow = ALLOW_REASON[mode];
  return {
    allowed: true,
    decision: mode,
    reasonCode: allow.code,
    reason: allow.text,
    spec,
    permission,
    parameters: parameters.value,
    fields,
    audience: mode === "TOOL_BOUND" ? request.audience : undefined,
  };
}

function validateParameters(
  spec: ResourceSpec,
  raw: Record<string, unknown>,
  mandate: TaskMandate,
): { value: Record<string, unknown> } | { denial: Denial } {
  let value: Record<string, unknown> = {};
  if (spec.parameters) {
    const parsed = spec.parameters.safeParse(raw);
    if (!parsed.success) {
      const fields = [...new Set(parsed.error.issues.map((i) => i.path.join(".") || "(root)"))].join(", ");
      return { denial: deny("OUT_OF_SCOPE", `Request parameters are invalid: ${fields}.`) };
    }
    value = parsed.data;
  }
  for (const bound of spec.mandateBoundParams ?? []) {
    const expected = mandate.constraints[bound.constraint];
    const actual = value[bound.param];
    if (expected !== undefined && !sameText(actual, expected)) {
      return { denial: deny("OUT_OF_SCOPE", `Parameter '${bound.param}' is outside the authorized task.`) };
    }
  }
  return { value };
}

function sameText(a: unknown, b: unknown): boolean {
  return typeof a === "string" && typeof b === "string" && a.trim().toLowerCase() === b.trim().toLowerCase();
}
