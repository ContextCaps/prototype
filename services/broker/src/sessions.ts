import type { AgentSessionGrant, ContextCapability } from "@contextcaps/shared-types";
import { secretToken } from "./runtime";

/**
 * Server-side agent identity binding.
 *
 * A session token is an unguessable bearer value issued by the broker when it
 * creates a capability (mandate root or delegated child). The broker resolves
 * agentId / mandateId / capabilityId / purpose from the token; those fields are
 * never taken from a caller- or model-supplied request body.
 */
export class SessionStore {
  readonly #sessions = new Map<string, AgentSessionGrant>();

  issue(capability: ContextCapability): AgentSessionGrant {
    const grant: AgentSessionGrant = {
      sessionId: secretToken("ses"),
      agentId: capability.agentId,
      mandateId: capability.mandateId,
      capabilityId: capability.capabilityId,
      purpose: capability.purpose,
      expiresAt: capability.expiresAt,
    };
    this.#sessions.set(grant.sessionId, grant);
    return { ...grant };
  }

  /**
   * Returns the binding for a token, or undefined if unknown. Expiry and
   * revocation are NOT decided here — the policy engine evaluates the bound
   * capability on every request, so a revoked/expired session fails with the
   * capability's own reason code.
   */
  resolve(sessionId: string | undefined): AgentSessionGrant | undefined {
    if (!sessionId) return undefined;
    const grant = this.#sessions.get(sessionId);
    return grant ? { ...grant } : undefined;
  }

  /** The root agent's session for a mandate (used by the in-process agent runner). */
  rootSessionFor(mandateId: string, rootCapabilityId: string): AgentSessionGrant | undefined {
    for (const grant of this.#sessions.values()) {
      if (grant.mandateId === mandateId && grant.capabilityId === rootCapabilityId) return { ...grant };
    }
    return undefined;
  }

  reset(): void {
    this.#sessions.clear();
  }
}
