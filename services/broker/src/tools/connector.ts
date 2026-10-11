import type { ToolSecret } from "@contextcaps/vault";

/**
 * An approved tool that may receive tool-bound secrets.
 * Connectors run inside the broker's trust boundary; their output is still
 * filtered through `outputFields` before anything returns to an agent.
 */
export interface ToolConnector {
  readonly toolId: string;
  /** Argument name → the resource whose handle must be supplied in it. */
  readonly handleArguments: Readonly<Record<string, string>>;
  /** Only these output fields are ever returned to the agent/LLM. */
  readonly outputFields: readonly string[];
  /** Validates non-handle arguments. Returns an error message or undefined. */
  validate(args: Record<string, unknown>): string | undefined;
  /** Amount the call would charge, checked against the mandate budget. */
  chargeUsd?(args: Record<string, unknown>): number | undefined;
  /** `secrets` is keyed by resource name. Throws on failure; the gateway fails closed. */
  execute(args: Record<string, unknown>, secrets: Readonly<Record<string, ToolSecret>>): Promise<Record<string, unknown>>;
}
