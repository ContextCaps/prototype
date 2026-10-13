import { PrivyProvider, getEmbeddedConnectedWallet, useCreateWallet, useLogin, usePrivy, useWallets } from "@privy-io/react-auth";
import { useState, type ReactNode } from "react";
import { WalletContext, type WalletSession } from "./WalletContext";
import type { Eip1193Provider } from "./wallet";

const MONAD_TESTNET = {
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://testnet-rpc.monad.xyz"] } },
  blockExplorers: { default: { name: "Monadscan", url: "https://testnet.monadscan.com" } },
  testnet: true,
} as const;

function PrivyWalletBridge({ children }: { children: ReactNode }) {
  const { ready, authenticated, logout } = usePrivy();
  const { ready: walletsReady, wallets } = useWallets();
  const { createWallet } = useCreateWallet();
  const [error, setError] = useState<string>();
  const [creating, setCreating] = useState(false);
  const { login } = useLogin({ onError: () => setError("Privy login failed. Try logging in again.") });
  // Use an embedded wallet consistently; never silently sign from a linked external account.
  const embedded = authenticated && walletsReady ? getEmbeddedConnectedWallet(wallets) : null;
  const session: WalletSession = {
    kind: "privy", ready: ready && walletsReady && !creating, available: true, authenticated,
    account: embedded?.address ?? null, error,
    connect: async () => {
      setError(undefined);
      if (!ready || !walletsReady) throw new Error("Privy is still loading. Try again in a moment.");
      if (!authenticated) { login(); return; }
      if (!embedded) {
        setCreating(true);
        try { await createWallet(); }
        finally { setCreating(false); }
      }
    },
    disconnect: logout,
    getProvider: async () => {
      if (!authenticated || !embedded) throw new Error("Log in with Privy and create your wallet first.");
      await embedded.switchChain(MONAD_TESTNET.id);
      return await embedded.getEthereumProvider() as Eip1193Provider;
    },
  };
  return <WalletContext.Provider value={session}>{children}</WalletContext.Provider>;
}

export default function PrivyWalletProvider({ appId, children }: { appId: string; children: ReactNode }) {
  return (
    <PrivyProvider appId={appId} config={{
      loginMethods: ["email"],
      appearance: { theme: "light", accentColor: "#6D47F5", logo: "/logo-mark.png" },
      embeddedWallets: { ethereum: { createOnLogin: "all-users" }, showWalletUIs: true },
      defaultChain: MONAD_TESTNET,
      supportedChains: [MONAD_TESTNET],
    }}>
      <PrivyWalletBridge>{children}</PrivyWalletBridge>
    </PrivyProvider>
  );
}
