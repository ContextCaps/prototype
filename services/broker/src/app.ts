import { OpenAiLlmProvider, runLlmScenario, type LlmProvider } from "@contextcaps/agent";
import { ContextVault } from "@contextcaps/vault";
import type { FastifyInstance } from "fastify";
import { buildServer } from "./api/server";
import { ContextBroker } from "./broker";
import { MockCapabilityStateProvider } from "./chain/mockProvider";
import type { CapabilityStateProvider } from "./chain/stateProvider";
import type { BrokerConfig } from "./config";
import { createLogger, type SafeLogger } from "./logger";
import { randomIds, systemClock, type Clock, type IdGenerator } from "./runtime";
import { createContractClientFromEnv } from "@contextcaps/contract-sdk";
import { ContractSdkCapabilityStateProvider } from "./chain/contractSdkProvider";
import { MockBookingConnector } from "./tools/bookingConnector";

export interface AppOverrides {
  clock?: Clock;
  ids?: IdGenerator & { reset?(): void };
  logger?: SafeLogger;
  provider?: CapabilityStateProvider;
  /** Overrides the LLM planner provider (e.g. a deterministic fake in tests). */
  llmProvider?: LlmProvider;
  /** Overrides wallet-mode on-chain confirmation polling (tests). */
  confirmation?: { attempts: number; delayMs: number };
}

export interface BrokerApp {
  server: FastifyInstance;
  broker: ContextBroker;
  vault: ContextVault;
  provider: CapabilityStateProvider;
  booking: MockBookingConnector;
}

/** Composition root: wires vault, trust-layer provider, tools, broker and HTTP API. */
export async function createBrokerApp(
  config: Pick<BrokerConfig, "receiptKey" | "demoMode" | "corsOrigins" | "chainProvider"> &
    Partial<Pick<BrokerConfig, "llmPlanner" | "llmModel" | "llmEffort" | "principalSigning">>,
  overrides: AppOverrides = {},
): Promise<BrokerApp> {
  const clock = overrides.clock ?? systemClock;
  const ids: IdGenerator & { reset?(): void } = overrides.ids ?? randomIds;
  const logger = overrides.logger ?? createLogger();

  let provider = overrides.provider;
  if (!provider) {
    if (config.chainProvider === "monad") {
      provider = new ContractSdkCapabilityStateProvider(await createContractClientFromEnv());
    } else {
      provider = new MockCapabilityStateProvider(clock);
    }
  }

  const vault = new ContextVault();
  const booking = new MockBookingConnector();
  const broker = new ContextBroker({
    vault,
    provider,
    connectors: [booking],
    receiptKey: config.receiptKey,
    clock,
    ids,
    logger,
    principalSigning: config.principalSigning,
    confirmation: overrides.confirmation,
  });

  const llmProvider =
    overrides.llmProvider ??
    (config.llmPlanner === "openai" ? new OpenAiLlmProvider({ model: config.llmModel, effort: config.llmEffort }) : undefined);

  const server = await buildServer({
    broker,
    clock,
    llmRunner: llmProvider ? (input) => runLlmScenario(broker, input, llmProvider) : undefined,
    demoMode: config.demoMode,
    corsOrigins: config.corsOrigins,
    onReset: () => {
      vault.reset();
      booking.reset();
      ids.reset?.();
      if (provider instanceof MockCapabilityStateProvider) provider.reset();
    },
  });

  return { server, broker, vault, provider, booking };
}
