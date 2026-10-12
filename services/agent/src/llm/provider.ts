/** One planner turn request: everything the model sees. */
export interface PlannerRequest {
  system: string;
  messages: PlannerMessage[];
  tools: PlannerTool[];
}

export interface PlannerTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export type PlannerTextBlock = { type: "text"; text: string };
export type PlannerToolUseBlock = { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };
export type PlannerToolResultBlock = { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };
export type PlannerMessage =
  | { role: "user"; content: string | PlannerToolResultBlock[] }
  | { role: "assistant"; content: Array<PlannerTextBlock | PlannerToolUseBlock> };
export type PlannerStopReason = "tool_use" | "end_turn" | "max_tokens" | "refusal";
export interface PlannerResponse {
  content: Array<PlannerTextBlock | PlannerToolUseBlock>;
  stop_reason: PlannerStopReason;
}

/** Provider boundary. Tests use a deterministic fake; production uses OpenAI GPT. */
export interface LlmProvider {
  readonly name: string;
  createMessage(request: PlannerRequest): Promise<PlannerResponse>;
}

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface OpenAiProviderOptions {
  /** Defaults to OPENAI_API_KEY. Kept injectable so request mapping is testable without a network call. */
  apiKey?: string;
  model?: string;
  effort?: Effort;
  fetch?: typeof globalThis.fetch;
}

export const DEFAULT_PLANNER_MODEL = "gpt-5.4-mini";

export class OpenAiApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "OpenAiApiError";
    this.status = status;
  }
}

/**
 * GPT-backed planner provider using Chat Completions function calling.
 *
 * Context access remains broker tools only; this client never receives a
 * session token or a vault credential.
 */
export class OpenAiLlmProvider implements LlmProvider {
  readonly name = "openai";
  readonly #apiKey: string;
  readonly #model: string;
  readonly #effort: Exclude<Effort, "max">;
  readonly #fetch: typeof globalThis.fetch;

  constructor(options: OpenAiProviderOptions = {}) {
    const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey?.trim()) throw new Error("OPENAI_API_KEY must be set when LLM_PLANNER=openai");
    this.#apiKey = apiKey;
    this.#model = options.model ?? DEFAULT_PLANNER_MODEL;
    this.#effort = options.effort === "max" ? "xhigh" : (options.effort ?? "low");
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  async createMessage(request: PlannerRequest): Promise<PlannerResponse> {
    const response = await this.#fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${this.#apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: this.#model,
        reasoning_effort: this.#effort,
        max_completion_tokens: 4096,
        messages: toOpenAiMessages(request),
        tools: request.tools.map((tool) => ({
          type: "function",
          function: { name: tool.name, description: tool.description, parameters: tool.input_schema },
        })),
      }),
    });
    if (!response.ok) throw new OpenAiApiError(response.status, `OpenAI API request failed (${response.status}).`);

    const body = (await response.json()) as OpenAiCompletion;
    const message = body.choices?.[0]?.message;
    if (!message) throw new OpenAiApiError(response.status, "OpenAI API response had no message.");
    const content: PlannerResponse["content"] = [];
    if (message.content?.trim()) content.push({ type: "text", text: message.content });
    for (const toolCall of message.tool_calls ?? []) {
      let input: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(toolCall.function.arguments) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) input = parsed as Record<string, unknown>;
      } catch {
        // The planner validates malformed tool input and returns an error to the model.
      }
      content.push({ type: "tool_use", id: toolCall.id, name: toolCall.function.name, input });
    }
    return {
      content,
      stop_reason: body.choices?.[0]?.finish_reason === "length" ? "max_tokens" : content.some((block) => block.type === "tool_use") ? "tool_use" : "end_turn",
    };
  }
}

interface OpenAiCompletion {
  choices?: Array<{
    finish_reason?: string | null;
    message?: { content?: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> };
  }>;
}

function toOpenAiMessages(request: PlannerRequest): unknown[] {
  const messages: unknown[] = [{ role: "system", content: request.system }];
  for (const message of request.messages) {
    if (typeof message.content === "string") {
      messages.push({ role: message.role, content: message.content });
      continue;
    }
    if (message.role === "assistant") {
      const text = message.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
      const toolCalls = message.content
        .filter((block): block is PlannerToolUseBlock => block.type === "tool_use")
        .map((block) => ({ id: block.id, type: "function", function: { name: block.name, arguments: JSON.stringify(block.input) } }));
      messages.push({ role: "assistant", content: text || null, ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}) });
      continue;
    }
    for (const block of message.content) messages.push({ role: "tool", tool_call_id: block.tool_use_id, content: block.content });
  }
  return messages;
}
