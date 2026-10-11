export interface BrokerConfig {
  port: number;
  host: string;
  /** "mock" until Person 1's SDK is wired in (see chain/contractSdkProvider.ts). */
  chainProvider: "mock" | "monad";
  receiptKey: string;
  demoMode: boolean;
  corsOrigins: string[] | true;
}

const DEV_RECEIPT_KEY = "contextcaps-dev-receipt-key";

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BrokerConfig {
  const chainProvider = env.CHAIN_PROVIDER === "monad" ? "monad" : "mock";
  const receiptKey = env.RECEIPT_HMAC_KEY ?? DEV_RECEIPT_KEY;
  if (chainProvider === "monad" && receiptKey === DEV_RECEIPT_KEY) {
    throw new Error("RECEIPT_HMAC_KEY must be set when CHAIN_PROVIDER=monad");
  }
  return {
    port: Number(env.BROKER_PORT ?? 8787),
    host: env.BROKER_HOST ?? "127.0.0.1",
    chainProvider,
    receiptKey,
    demoMode: (env.DEMO_MODE ?? "true") === "true",
    corsOrigins: env.CORS_ORIGINS ? env.CORS_ORIGINS.split(",").map((s) => s.trim()) : true,
  };
}
