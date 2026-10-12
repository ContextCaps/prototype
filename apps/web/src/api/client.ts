import type {
  AgentRunRequest,
  AgentRunResult,
  AuditResponse,
  CapabilityStateResponse,
  CreateMandateRequest,
  CreateMandateResponse,
  HealthResponse,
  PendingMandateResponse,
  PrepareRevocationResponse,
} from "./types";

/**
 * Principal-side broker client. The web app never calls agent endpoints
 * (/context/request, /delegations, /tools): agents run server-side through
 * POST /agent/runs, so session tokens never need to live in the browser.
 */
const BASE = (import.meta.env.VITE_API_BASE || "/api/v1").replace(/\/$/, "");

export class BrokerError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new BrokerError(0, "BROKER_UNREACHABLE", "Cannot reach the ContextCaps broker. Is it running?");
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const code = String(json.error ?? json.reasonCode ?? `HTTP_${res.status}`);
    throw new BrokerError(res.status, code, String(json.message ?? json.reason ?? `Broker returned ${res.status}.`));
  }
  return json as T;
}

export const broker = {
  health: () => call<HealthResponse>("GET", "/health"),
  /** 201 with a session (server signing) or 202 awaiting the user's wallet signature (wallet signing). */
  createMandate: (req: CreateMandateRequest) => call<CreateMandateResponse | PendingMandateResponse>("POST", "/mandates", req),
  confirmMandate: (mandateId: string, txHash: string) =>
    call<CreateMandateResponse>("POST", `/mandates/${encodeURIComponent(mandateId)}/confirm`, { txHash }),
  runAgent: (req: AgentRunRequest) => call<AgentRunResult>("POST", "/agent/runs", req),
  getCapability: (id: string) => call<CapabilityStateResponse>("GET", `/capabilities/${encodeURIComponent(id)}`),
  prepareRevocation: (id: string) => call<PrepareRevocationResponse>("POST", `/capabilities/${encodeURIComponent(id)}/revoke/prepare`),
  /** Wallet signing passes the hash of the revocation the user's wallet sent. */
  revokeCapability: (id: string, txHash?: string) =>
    call<CapabilityStateResponse>("POST", `/capabilities/${encodeURIComponent(id)}/revoke`, txHash ? { txHash } : undefined),
  audit: (mandateId: string) => call<AuditResponse>("GET", `/audit?mandateId=${encodeURIComponent(mandateId)}`),
  resetDemo: () => call<{ ok: true }>("POST", "/demo/reset", {}),
};
