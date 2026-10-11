import { canonicalJson, evaluateCapabilityState } from "@contextcaps/policy";
import type { ReasonCode, ToolInvocationRequest, ToolInvocationResult } from "@contextcaps/shared-types";
import type { ContextVault, ToolSecret } from "@contextcaps/vault";
import type { CapabilityStateProvider } from "../chain/stateProvider";
import type { HandleBinding, HandleStore } from "../handles";
import { resolveContext } from "../lineage";
import type { SafeLogger } from "../logger";
import type { ReceiptLedger } from "../receipts";
import type { Clock } from "../runtime";
import type { BrokerStore } from "../store";
import type { ToolConnector } from "./connector";

interface GatewayDeps {
  store: BrokerStore;
  provider: CapabilityStateProvider;
  vault: ContextVault;
  handles: HandleStore;
  ledger: ReceiptLedger;
  logger: SafeLogger;
  clock: Clock;
  connectors: ToolConnector[];
}

type Rejection = { reasonCode: ReasonCode; reason: string };

/**
 * Tool gateway — the only code path that resolves tool-bound secrets.
 *
 * agent → (opaque handles) → gateway → checks capability + handles
 *       → vault.resolveToolSecret → connector.execute → allowlisted output → agent
 */
export class ToolGateway {
  readonly #deps: GatewayDeps;
  readonly #connectors: Map<string, ToolConnector>;

  constructor(deps: GatewayDeps) {
    this.#deps = deps;
    this.#connectors = new Map(deps.connectors.map((c) => [c.toolId, c]));
  }

  async invoke(toolId: string, request: ToolInvocationRequest): Promise<ToolInvocationResult> {
    const started = performance.now();
    const { clock, logger } = this.#deps;
    const now = clock();
    const timestamp = now.toISOString();
    const requestForHash = { ...request, toolId };

    const outcome = await this.#authorizeAndExecute(toolId, request, now);

    const receiptIds: string[] = [];
    if ("rejection" in outcome) {
      const receipt = await this.#deps.ledger.record({
        kind: "tool_invocation",
        requestId: request.requestId,
        mandateId: request.mandateId,
        capabilityId: request.capabilityId,
        agentId: request.agentId,
        resource: `tool:${toolId}`,
        operation: "invoke",
        decision: "DENY",
        reasonCode: outcome.rejection.reasonCode,
        allowed: false,
        reason: outcome.rejection.reason,
        requestForHash,
        timestamp,
      });
      receiptIds.push(receipt.receiptId);
    } else {
      for (const binding of outcome.bindings) {
        const receipt = await this.#deps.ledger.record({
          kind: "tool_invocation",
          requestId: request.requestId,
          mandateId: request.mandateId,
          capabilityId: request.capabilityId,
          agentId: request.agentId,
          resource: binding.resource,
          operation: `inject:${toolId}`,
          decision: "TOOL_BOUND",
          reasonCode: "ALLOW_TOOL_BOUND",
          allowed: true,
          reason: "Secret injected directly into the approved tool; not returned to the agent.",
          requestForHash,
          resultForHash: outcome.output,
          timestamp,
        });
        receiptIds.push(receipt.receiptId);
      }
    }

    const allowed = !("rejection" in outcome);
    const reasonCode = allowed ? "ALLOW_TOOL_BOUND" : outcome.rejection.reasonCode;
    logger.info("tool.invoke", {
      requestId: request.requestId,
      agentId: request.agentId,
      capabilityId: request.capabilityId,
      toolId,
      decision: allowed ? "TOOL_BOUND" : "DENY",
      reasonCode,
      latencyMs: Math.round(performance.now() - started),
    });

    return {
      requestId: request.requestId,
      toolId,
      allowed,
      decision: allowed ? "TOOL_BOUND" : "DENY",
      reasonCode,
      reason: allowed ? "Tool executed with tool-bound credentials." : outcome.rejection.reason,
      result: allowed ? outcome.output : undefined,
      receiptIds,
      timestamp,
    };
  }

  async #authorizeAndExecute(
    toolId: string,
    request: ToolInvocationRequest,
    now: Date,
  ): Promise<{ rejection: Rejection } | { bindings: HandleBinding[]; output: Record<string, unknown> }> {
    const { store, provider, vault, handles } = this.#deps;
    const connector = this.#connectors.get(toolId);
    if (!connector) return reject("TOOL_NOT_ALLOWED", "Tool is not an approved connector.");

    const ctx = await resolveContext(store, provider, request.capabilityId, request.mandateId, now);
    const stateDenial = evaluateCapabilityState(request, ctx);
    if (stateDenial) return reject(stateDenial.reasonCode, stateDenial.reason);

    const args = request.arguments ?? {};
    const invalid = connector.validate(args);
    if (invalid) return reject("OUT_OF_SCOPE", `Tool arguments rejected: ${invalid}.`);

    const bindings: HandleBinding[] = [];
    for (const [argName, resource] of Object.entries(connector.handleArguments)) {
      const value = args[argName];
      const binding = typeof value === "string" ? handles.get(value) : undefined;
      if (!binding || binding.consumed || now.getTime() >= Date.parse(binding.expiresAt)) {
        return reject("TOOL_NOT_ALLOWED", `Missing, used or expired handle for ${resource}.`);
      }
      if (
        binding.capabilityId !== request.capabilityId ||
        binding.agentId !== request.agentId ||
        binding.mandateId !== request.mandateId ||
        binding.resource !== resource
      ) {
        return reject("TOOL_NOT_ALLOWED", `Handle for ${resource} is not bound to this capability.`);
      }
      if (binding.audience !== toolId) {
        return reject("AUDIENCE_NOT_ALLOWED", `Handle for ${resource} is bound to a different tool.`);
      }
      bindings.push(binding);
    }

    const budget = ctx.mandate?.constraints.budgetUsd;
    const charge = connector.chargeUsd?.(args);
    if (budget !== undefined && charge !== undefined && charge > budget) {
      return reject("OUT_OF_SCOPE", "Charge exceeds the authorized task budget.");
    }

    const secrets: Record<string, ToolSecret> = {};
    for (const binding of bindings) secrets[binding.resource] = vault.resolveToolSecret(binding.resource);

    const plainArgs = Object.fromEntries(Object.entries(args).filter(([k]) => !(k in connector.handleArguments)));
    let raw: Record<string, unknown>;
    try {
      raw = await connector.execute(plainArgs, secrets);
    } catch {
      return reject("TOOL_NOT_ALLOWED", "Tool execution failed.");
    }

    const output: Record<string, unknown> = {};
    for (const field of connector.outputFields) {
      if (field in raw) output[field] = raw[field];
    }
    // Tool responses are untrusted: fail closed if a secret would echo back to the agent.
    if (containsSecret(output, secrets)) {
      return reject("TOOL_NOT_ALLOWED", "Tool output contained protected data and was withheld.");
    }

    for (const binding of bindings) handles.consume(binding.handle);
    return { bindings, output };
  }
}

function reject(reasonCode: ReasonCode, reason: string): { rejection: Rejection } {
  return { rejection: { reasonCode, reason } };
}

function containsSecret(output: Record<string, unknown>, secrets: Record<string, ToolSecret>): boolean {
  const serialized = canonicalJson(output);
  return Object.values(secrets).some((secret) =>
    Object.entries(secret).some(([key, value]) => key !== "kind" && typeof value === "string" && value.length > 3 && serialized.includes(value)),
  );
}
