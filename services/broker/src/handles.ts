import type { AgentId, CapabilityId, MandateId } from "@contextcaps/shared-types";
import { secretHandleId } from "./runtime";

export interface HandleBinding {
  handle: string;
  mandateId: MandateId;
  capabilityId: CapabilityId;
  agentId: AgentId;
  resource: string;
  audience: string;
  expiresAt: string;
  consumed: boolean;
}

/** Default lifetime of a tool-bound handle. */
export const HANDLE_TTL_MS = 15 * 60 * 1000;

/**
 * Opaque handles for TOOL_BOUND disclosure. A handle is a reference, not the
 * secret: it is bound to one capability, agent, resource and tool, and is
 * single-use. The secret is resolved from the vault only inside the tool gateway.
 */
export class HandleStore {
  readonly #handles = new Map<string, HandleBinding>();

  issue(binding: Omit<HandleBinding, "handle" | "consumed">): HandleBinding {
    const record: HandleBinding = { ...binding, handle: secretHandleId(), consumed: false };
    this.#handles.set(record.handle, record);
    return record;
  }

  get(handle: string): HandleBinding | undefined {
    return this.#handles.get(handle);
  }

  /**
   * Atomically reserves every handle for one connector invocation.
   *
   * This method contains no await points. In Node's event loop that makes the
   * check-and-consume transition indivisible: a concurrent invocation sees the
   * first invocation's handles as consumed before it can reach a connector.
   */
  consumeAllIfAvailable(handles: readonly string[], now: Date): boolean {
    const records = handles.map((handle) => this.#handles.get(handle));
    if (records.some((record) => !record || record.consumed || now.getTime() >= Date.parse(record.expiresAt))) {
      return false;
    }
    for (const record of records) record!.consumed = true;
    return true;
  }

  reset(): void {
    this.#handles.clear();
  }
}
