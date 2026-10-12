export interface BrokerConfig {
  port: number;
  host: string;
  /** Monad uses the Person 1 SDK; mock is a deterministic local fallback. */
  chainProvider: "mock" | "monad";
  /** "wallet": the principal's own wallet signs root registration and revocation (requires monad). */
  principalSigning: "server" | "wallet";
  receiptKey: string;
  demoMode: boolean;
  corsOrigins: string[] | true;
  /** "openai" enables the GPT planner (explicit opt-in: it spends API credits). */
  llmPlanner: "off" | "openai";
  llmModel?: string;
  llmEffort?: "low" | "medium" | "high" | "xhigh" | "max";
}

const DEV_RECEIPT_KEY = "contextcaps-dev-receipt-key";

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BrokerConfig {
  const chainProvider = env.CHAIN_PROVIDER === "monad" ? "monad" : "mock";
  const receiptKey = env.RECEIPT_HMAC_KEY ?? DEV_RECEIPT_KEY;
  if (chainProvider === "monad" && (receiptKey === DEV_RECEIPT_KEY || receiptKey.trim().length === 0)) {
    throw new Error("RECEIPT_HMAC_KEY must be set when CHAIN_PROVIDER=monad");
  }
  const principalSigning = env.PRINCIPAL_SIGNING === "wallet" ? "wallet" : "server";
  if (principalSigning === "wallet" && chainProvider !== "monad") {
    throw new Error("PRINCIPAL_SIGNING=wallet requires CHAIN_PROVIDER=monad");
  }
  return {
    port: Number(env.BROKER_PORT ?? 8787),
    host: env.BROKER_HOST ?? "127.0.0.1",
    chainProvider,
    principalSigning,
    receiptKey,
    demoMode: (env.DEMO_MODE ?? "true") === "true",
    corsOrigins: env.CORS_ORIGINS ? env.CORS_ORIGINS.split(",").map((s) => s.trim()) : true,
    llmPlanner: env.LLM_PLANNER === "openai" ? "openai" : "off",
    llmModel: env.OPENAI_MODEL || undefined,
    llmEffort: parseEffort(env.LLM_EFFORT),
  };
}

function parseEffort(value: string | undefined): BrokerConfig["llmEffort"] {
  return value === "low" || value === "medium" || value === "high" || value === "xhigh" || value === "max" ? value : undefined;
}
