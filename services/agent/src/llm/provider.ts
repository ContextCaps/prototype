import Anthropic from "@anthropic-ai/sdk";

/** One planner turn request: everything the model sees. */
export interface PlannerRequest {
  system: string;
  messages: Anthropic.Beta.BetaMessageParam[];
  tools: Anthropic.Beta.BetaTool[];
}

/**
 * LLM provider boundary. The planner depends only on this, so tests and demos
 * can use a deterministic fake while production uses Claude.
 */
export interface LlmProvider {
  readonly name: string;
  createMessage(request: PlannerRequest): Promise<Anthropic.Beta.BetaMessage>;
}

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface AnthropicProviderOptions {
  /** Defaults to a zero-arg client: ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / `ant auth login` profile. */
  client?: Anthropic;
  model?: string;
  effort?: Effort;
}

export const DEFAULT_PLANNER_MODEL = "claude-opus-5-5";

/**
 * Claude-backed planner provider.
 *
 * - Thinking stays on (adaptive is the only mode on this model); depth is set via `effort`.
 * - Server-side refusal fallback is enabled (`fallbacks: "default"`), so a
 *   classifier decline is retried on Anthropic's recommended fallback model.
 * - Tools + system prompt are stable across turns, so the prefix is cached.
 */
export class AnthropicLlmProvider implements LlmProvider {
  readonly name = "anthropic";
  readonly #client: Anthropic;
  readonly #model: string;
  readonly #effort: Effort;

  constructor(options: AnthropicProviderOptions = {}) {
    this.#client = options.client ?? new Anthropic();
    this.#model = options.model ?? DEFAULT_PLANNER_MODEL;
    this.#effort = options.effort ?? "medium";
  }

  createMessage(request: PlannerRequest): Promise<Anthropic.Beta.BetaMessage> {
    return this.#client.beta.messages.create({
      model: this.#model,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: this.#effort },
      cache_control: { type: "ephemeral" },
      system: request.system,
      tools: request.tools,
      messages: request.messages,
    });
  }
}
