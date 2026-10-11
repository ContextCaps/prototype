import type { AgentId } from "@contextcaps/shared-types";

/**
 * The LLM-visible trace: every piece of text/data that enters an agent's
 * model context. Tests assert that no seeded private value ever appears here.
 */
export type TraceEntry =
  | { seq: number; agentId: AgentId; kind: "task"; text: string }
  | { seq: number; agentId: AgentId; kind: "note"; text: string }
  | { seq: number; agentId: AgentId; kind: "external_content"; source: string; text: string; untrusted: true }
  | { seq: number; agentId: AgentId; kind: "tool_call"; tool: string; input: unknown; output: unknown };

type NewEntry = TraceEntry extends infer E ? (E extends TraceEntry ? Omit<E, "seq"> : never) : never;

export class Trace {
  readonly entries: TraceEntry[] = [];

  add(entry: NewEntry): void {
    this.entries.push({ ...entry, seq: this.entries.length + 1 } as TraceEntry);
  }
}
