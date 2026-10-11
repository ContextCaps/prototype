import type {
  CreateDelegationResponse,
  DisclosureDecision,
  SessionContextRequest,
  SessionDelegationRequest,
  SessionToolInvocationRequest,
  ToolInvocationResult,
} from "@contextcaps/shared-types";

/**
 * Everything an agent can do that touches private context goes through this
 * port. Every call carries only a broker-issued session token; the broker
 * resolves the agent's identity and capability from it. There is intentionally
 * no vault access here: the only path to private data is
 * Agent → Broker → Policy → Vault/Tool.
 */
export interface BrokerPort {
  requestContextForSession(sessionId: string, request: SessionContextRequest): Promise<DisclosureDecision>;
  delegateForSession(sessionId: string, request: SessionDelegationRequest): Promise<CreateDelegationResponse>;
  invokeToolForSession(sessionId: string, toolId: string, request: SessionToolInvocationRequest): Promise<ToolInvocationResult>;
}
