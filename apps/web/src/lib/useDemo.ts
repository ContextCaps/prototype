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
import { sendAndConfirm, type TxStage } from "./wallet";
import { useWalletSession } from "./WalletContext";

/** The authorized mandate as the UI keeps it. The root agent's session token is dropped on purpose. */
export type Authorization = Omit<CreateMandateResponse, "session">;

export type Busy = "authorize" | "run" | "revoke" | "retry" | "reset" | "connect" | null;

export interface DemoState {
  health: HealthResponse | null;
  healthError: string | null;
  /** Connected wallet account (wallet signing only). Survives demo resets. */
  account: string | null;
  auth: Authorization | null;
  run: AgentRunResult | null;
  retry: AgentRunResult | null;
  root: CapabilityStateResponse | null;
  child: CapabilityStateResponse | null;
  audit: AuditResponse | null;
  busy: Busy;
  /** Human-readable step of a wallet transaction in flight. */
  progress: string | null;
  error: string | null;
}

const EMPTY: Omit<DemoState, "health" | "healthError" | "account"> = {
  auth: null,
  run: null,
  retry: null,
  root: null,
  child: null,
  audit: null,
  busy: null,
  progress: null,
  error: null,
};

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

const STAGE_TEXT: Record<TxStage, string> = {
  sign: "Confirm in your wallet…",
  confirm: "Waiting for Monad to confirm…",
};

/**
 * Drives the golden demo against the real broker. Every allow/deny,
 * delegation and revocation shown in the UI comes from a broker response;
 * nothing is decided in frontend state (docs/PERSON_3_PRODUCT.md, Demo Reliability).
 *
 * With wallet signing, the user's wallet sends the root registration and the
 * revocation itself; the broker only acts once it sees them on-chain.
 */
export function useDemo() {
  const wallet = useWalletSession();
  const [state, setState] = useState<DemoState>({ ...EMPTY, health: null, healthError: null, account: null });
  const patch = useCallback((p: Partial<DemoState>) => setState((s) => ({ ...s, ...p })), []);
  const walletMode = state.health?.principalSigning === "wallet";

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
      patch({ busy, error: null, progress: null });
      try {
        patch({ ...(await fn()), busy: null, progress: null });
      } catch (e) {
        patch({ busy: null, progress: null, error: message(e) });
      }
    },
    [patch],
  );

  const onStage = useCallback((stage: TxStage) => patch({ progress: STAGE_TEXT[stage] }), [patch]);

  /** Re-reads capability state and the audit trail for the current mandate. */
  const snapshot = useCallback(async (auth: Authorization, childId?: string) => {
    const [root, child, audit] = await Promise.all([
      broker.getCapability(auth.capability.capabilityId),
      childId ? broker.getCapability(childId) : Promise.resolve(null),
      broker.audit(auth.mandate.mandateId),
    ]);
    return { root, child, audit };
  }, []);

  const connect = () => act("connect", async () => { await wallet.connect(); return {}; });
  const disconnect = () => act("connect", async () => { await wallet.disconnect?.(); return {}; });

  const requirePrincipal = (principal: string) => {
    if (!wallet.ready || !wallet.account) throw new Error("Connect your wallet first.");
    if (wallet.account.toLowerCase() !== principal.toLowerCase()) {
      throw new Error("Reconnect the wallet that authorized this task before continuing.");
    }
  };

  const authorize = (req: CreateMandateRequest) =>
    act("authorize", async () => {
      if (wallet.kind === "privy" && !walletMode) throw new Error("This broker must enable user-wallet signing to authorize with Privy.");
      if (walletMode) requirePrincipal(req.principal);
      const response = await broker.createMandate(req);
      let created: CreateMandateResponse;
      if ("status" in response && response.status === "AWAITING_SIGNATURE") {
        requirePrincipal(req.principal);
        const txHash = await sendAndConfirm(req.principal, response.signRequest, onStage, await wallet.getProvider());
        patch({ progress: "Broker is verifying on-chain…" });
        created = await broker.confirmMandate(response.mandate.mandateId, txHash);
      } else {
        created = response as CreateMandateResponse;
      }
      const { session: _session, ...auth } = created;
      return { ...EMPTY, auth, ...(await snapshot(auth)) };
    });

  /** "llm" runs the real model planner (broker LLM_PLANNER=openai); it falls back to the script if the model fails. */
  const runAgent = (planner: "scripted" | "llm" = "scripted") =>
    act("run", async () => {
      if (!state.auth) throw new Error("Authorize the task first.");
      if (walletMode) requirePrincipal(state.auth.mandate.principal);
      const run = await broker.runAgent({ mandateId: state.auth.mandate.mandateId, planner });
      return { run, retry: null, ...(await snapshot(state.auth, run.childCapabilityId)) };
    });

  const revoke = () =>
    act("revoke", async () => {
      if (!state.auth) throw new Error("Nothing to revoke.");
      const capabilityId = state.auth.capability.capabilityId;
      if (walletMode) {
        requirePrincipal(state.auth.mandate.principal);
        const { signRequest } = await broker.prepareRevocation(capabilityId);
        const txHash = await sendAndConfirm(state.auth.mandate.principal, signRequest, onStage, await wallet.getProvider());
        patch({ progress: "Broker is verifying on-chain…" });
        await broker.revokeCapability(capabilityId, txHash);
      } else {
        await broker.revokeCapability(capabilityId);
      }
      return snapshot(state.auth, state.run?.childCapabilityId);
    });

  const retryAfterRevoke = () =>
    act("retry", async () => {
      if (!state.auth) throw new Error("Authorize the task first.");
      if (walletMode) requirePrincipal(state.auth.mandate.principal);
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

  return { state: { ...state, account: wallet.account }, wallet, walletMode, connect, disconnect, authorize, runAgent, revoke, retryAfterRevoke, reset, checkHealth };
}
