import { useCallback, useEffect, useState } from "react";
import { broker, BrokerError } from "../api/client";
import type {
  AgentRunResult,
  AuditResponse,
  CapabilityStateResponse,
  CreateMandateRequest,
  CreateMandateResponse,
  HealthResponse,
} from "../api/types";

/** The authorized mandate as the UI keeps it. The root agent's session token is dropped on purpose. */
export type Authorization = Omit<CreateMandateResponse, "session">;

export type Busy = "authorize" | "run" | "revoke" | "retry" | "reset" | null;

export interface DemoState {
  health: HealthResponse | null;
  healthError: string | null;
  auth: Authorization | null;
  run: AgentRunResult | null;
  retry: AgentRunResult | null;
  root: CapabilityStateResponse | null;
  child: CapabilityStateResponse | null;
  audit: AuditResponse | null;
  busy: Busy;
  error: string | null;
}

const EMPTY: Omit<DemoState, "health" | "healthError"> = {
  auth: null,
  run: null,
  retry: null,
  root: null,
  child: null,
  audit: null,
  busy: null,
  error: null,
};

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Drives the golden demo against the real broker. Every allow/deny,
 * delegation and revocation shown in the UI comes from a broker response;
 * nothing is decided in frontend state (docs/PERSON_3_PRODUCT.md, Demo Reliability).
 */
export function useDemo() {
  const [state, setState] = useState<DemoState>({ ...EMPTY, health: null, healthError: null });
  const patch = useCallback((p: Partial<DemoState>) => setState((s) => ({ ...s, ...p })), []);

  const checkHealth = useCallback(async () => {
    try {
      patch({ health: await broker.health(), healthError: null });
    } catch (e) {
      patch({ health: null, healthError: message(e) });
    }
  }, [patch]);

  useEffect(() => {
    void checkHealth();
  }, [checkHealth]);

  /** Runs one action with a busy flag and error capture. */
  const act = useCallback(
    async (busy: Exclude<Busy, null>, fn: () => Promise<Partial<DemoState>>) => {
      patch({ busy, error: null });
      try {
        patch({ ...(await fn()), busy: null });
      } catch (e) {
        patch({ busy: null, error: message(e) });
      }
    },
    [patch],
  );

  /** Re-reads capability state and the audit trail for the current mandate. */
  const snapshot = useCallback(async (auth: Authorization, childId?: string) => {
    const [root, child, audit] = await Promise.all([
      broker.getCapability(auth.capability.capabilityId),
      childId ? broker.getCapability(childId) : Promise.resolve(null),
      broker.audit(auth.mandate.mandateId),
    ]);
    return { root, child, audit };
  }, []);

  const authorize = (req: CreateMandateRequest) =>
    act("authorize", async () => {
      const { session: _session, ...auth } = await broker.createMandate(req);
      return { ...EMPTY, auth, ...(await snapshot(auth)) };
    });

  const runAgent = () =>
    act("run", async () => {
      if (!state.auth) throw new Error("Authorize the task first.");
      const run = await broker.runAgent({ mandateId: state.auth.mandate.mandateId });
      return { run, retry: null, ...(await snapshot(state.auth, run.childCapabilityId)) };
    });

  const revoke = () =>
    act("revoke", async () => {
      if (!state.auth) throw new Error("Nothing to revoke.");
      await broker.revokeCapability(state.auth.capability.capabilityId);
      return snapshot(state.auth, state.run?.childCapabilityId);
    });

  const retryAfterRevoke = () =>
    act("retry", async () => {
      if (!state.auth) throw new Error("Authorize the task first.");
      const retry = await broker.runAgent({ mandateId: state.auth.mandate.mandateId, scenario: "retry" });
      return { retry, ...(await snapshot(state.auth, state.run?.childCapabilityId)) };
    });

  const reset = () =>
    act("reset", async () => {
      try {
        await broker.resetDemo();
      } catch (e) {
        // 404 = broker not in DEMO_MODE; local state is still cleared.
        if (!(e instanceof BrokerError && e.status === 404)) throw e;
      }
      await checkHealth();
      return { ...EMPTY };
    });

  return { state, authorize, runAgent, revoke, retryAfterRevoke, reset, checkHealth };
}
