import { createContext, useContext } from "react";
import type { Eip1193Provider } from "./wallet";

export interface WalletSession {
  kind: "injected" | "privy";
  ready: boolean;
  available: boolean;
  authenticated: boolean;
  account: string | null;
  error?: string;
  connect(): Promise<void>;
  disconnect?: () => Promise<void>;
  getProvider(): Promise<Eip1193Provider>;
}

export const WalletContext = createContext<WalletSession | null>(null);

export function useWalletSession(): WalletSession {
  const session = useContext(WalletContext);
  if (!session) throw new Error("WalletProvider is required.");
  return session;
}
