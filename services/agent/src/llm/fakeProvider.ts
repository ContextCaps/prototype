import type Anthropic from "@anthropic-ai/sdk";
import type { LlmProvider, PlannerRequest } from "./provider";

export interface FakeToolCall {
  name: string;
  input: Record<string, unknown>;
}

export interface FakeTurn {
  text?: string;
  toolCalls?: FakeToolCall[];
  stopReason?: Anthropic.Beta.BetaStopReason;
}

/** A completed tool call as the fake model "remembers" it from the transcript. */
export interface ObservedToolResult {
  name: string;
  input: Record<string, unknown>;
  /** Parsed JSON content of the tool_result, or the raw string. */
  output: unknown;
  isError: boolean;
}

export type FakeScript = (ctx: { turn: number; request: PlannerRequest; results: ObservedToolResult[] }) => FakeTurn;

/**
 * Deterministic stand-in for Claude. It only sees what a real model would see
 * (the PlannerRequest), records every request for leak assertions, and replies
 * according to a script. Security is never tested through this — it exercises
 * the planner loop and the tool surface.
 */
export class FakeLlmProvider implements LlmProvider {
  readonly name = "fake";
  readonly requests: PlannerRequest[] = [];
  readonly #script: FakeScript;
  #ids = 0;

  constructor(script: FakeScript) {
    this.#script = script;
  }

  async createMessage(request: PlannerRequest): Promise<Anthropic.Beta.BetaMessage> {
    this.requests.push(structuredClone(request));
    const turn = this.#script({ turn: this.requests.length, request, results: observedResults(request) });
    const content: unknown[] = [];
    if (turn.text) content.push({ type: "text", text: turn.text, citations: null });
    for (const call of turn.toolCalls ?? []) {
      content.push({ type: "tool_use", id: `toolu_fake_${++this.#ids}`, name: call.name, input: call.input });
    }
    const stopReason = turn.stopReason ?? ((turn.toolCalls?.length ?? 0) > 0 ? "tool_use" : "end_turn");
    return {
      id: `msg_fake_${this.requests.length}`,
      type: "message",
      role: "assistant",
      model: "fake-planner",
      content,
      stop_reason: stopReason,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    } as unknown as Anthropic.Beta.BetaMessage;
  }
}

function observedResults(request: PlannerRequest): ObservedToolResult[] {
  const calls = new Map<string, { name: string; input: Record<string, unknown> }>();
  const results: ObservedToolResult[] = [];
  for (const message of request.messages) {
    if (typeof message.content === "string") continue;
    for (const block of message.content) {
      if (block.type === "tool_use") {
        calls.set(block.id, { name: block.name, input: block.input as Record<string, unknown> });
      } else if (block.type === "tool_result") {
        const call = calls.get(block.tool_use_id);
        const raw = typeof block.content === "string" ? block.content : "";
        let output: unknown = raw;
        try {
          output = JSON.parse(raw);
        } catch {
          // plain-text tool result
        }
        results.push({ name: call?.name ?? "?", input: call?.input ?? {}, output, isError: block.is_error === true });
      }
    }
  }
  return results;
}
