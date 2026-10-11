import type {
  ContextRequest,
  CreateDelegationRequest,
  CreateDelegationResponse,
  DisclosureDecision,
  ToolInvocationRequest,
  ToolInvocationResult,
} from "@contextcaps/shared-types";

/**
 * Everything an agent can do that touches private context goes through this
 * port. There is intentionally no vault access here: the only path to private
 * data is Agent → Broker → Policy → Vault/Tool.
 */
export interface BrokerPort {
  requestContext(request: ContextRequest): Promise<DisclosureDecision>;
  delegate(request: CreateDelegationRequest): Promise<CreateDelegationResponse>;
  invokeTool(toolId: string, request: ToolInvocationRequest): Promise<ToolInvocationResult>;
}
