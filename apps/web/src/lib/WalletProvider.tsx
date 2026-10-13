import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { WalletContext, type WalletSession } from "./WalletContext";
import { connectWallet, hasWallet, injectedProvider, watchAccount } from "./wallet";

const PrivyWalletProvider = lazy(() => import("./PrivyWalletProvider"));

function InjectedWalletProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<string | null>(null);
  useEffect(() => {
    const unwatch = watchAccount((address) => setAccount(address ?? null));
    let mounted = true;
    if (hasWallet()) {
      void injectedProvider().request({ method: "eth_accounts" }).then((value) => {
        if (mounted) setAccount((value as string[])[0] ?? null);
      }).catch(() => {});
    }
    return () => { mounted = false; unwatch(); };
  }, []);
  const session: WalletSession = {
    kind: "injected", ready: true, available: hasWallet(), authenticated: !!account, account,
    connect: async () => { setAccount(await connectWallet()); },
    getProvider: async () => injectedProvider(),
  };
  return <WalletContext.Provider value={session}>{children}</WalletContext.Provider>;
}

function UnconfiguredPrivyProvider({ children }: { children: ReactNode }) {
  const session: WalletSession = {
    kind: "privy", ready: true, available: false, authenticated: false, account: null,
    error: "Privy is not configured. Add your public VITE_PRIVY_APP_ID to apps/web/.env.local and restart the frontend.",
    connect: async () => { throw new Error("Privy App ID is required."); },
    getProvider: async () => { throw new Error("Privy App ID is required."); },
  };
  return <WalletContext.Provider value={session}>{children}</WalletContext.Provider>;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const appId = import.meta.env.VITE_PRIVY_APP_ID?.trim();
  const mode = import.meta.env.VITE_WALLET_PROVIDER ?? (appId ? "privy" : "injected");
  if (mode !== "privy") return <InjectedWalletProvider>{children}</InjectedWalletProvider>;
  if (!appId) return <UnconfiguredPrivyProvider>{children}</UnconfiguredPrivyProvider>;
  return (
    <Suspense fallback={<p className="container callout" role="status">Loading Privy wallet…</p>}>
      <PrivyWalletProvider appId={appId}>{children}</PrivyWalletProvider>
    </Suspense>
  );
}
