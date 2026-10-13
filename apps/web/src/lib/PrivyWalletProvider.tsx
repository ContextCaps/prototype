import { PrivyProvider, getEmbeddedConnectedWallet, useConnectWallet, useCreateWallet, useLogin, usePrivy, useWallets } from "@privy-io/react-auth";
import { useState, type ReactNode } from "react";
import { WalletContext, type WalletSession } from "./WalletContext";
import type { Eip1193Provider } from "./wallet";
import { resolveSigningWallet } from "./walletSelection";

const MONAD_TESTNET = {
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://testnet-rpc.monad.xyz"] } },
  blockExplorers: { default: { name: "Monadscan", url: "https://testnet.monadscan.com" } },
  testnet: true,
} as const;

function PrivyWalletBridge({ children }: { children: ReactNode }) {
  const { ready, authenticated, user, logout } = usePrivy();
  const { ready: walletsReady, wallets } = useWallets();
  const { createWallet } = useCreateWallet();
  const [error, setError] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [selection, setSelection] = useState<{ userId: string; address: string } | null>(null);
  const { login } = useLogin({
    onComplete: ({ user: loggedInUser, loginMethod, loginAccount }) => {
      // The login wallet is the signer. Email selects only the embedded wallet.
      const address = loginAccount?.type === "wallet" && loginAccount.chainType === "ethereum"
        ? loginAccount.address : loginMethod === "email" ? "embedded" : null;
      setSelection(address ? { userId: loggedInUser.id, address } : null);
    },
    onError: () => setError("Privy login failed. Try logging in again."),
  });
  const { connectWallet } = useConnectWallet({
    onSuccess: () => setError(undefined),
    onError: () => setError("Wallet connection failed. Try again."),
  });
  const embedded = authenticated && walletsReady ? getEmbeddedConnectedWallet(wallets) : null;
  const selected = resolveSigningWallet(wallets, selection?.address ?? null, authenticated && walletsReady && selection?.userId === user?.id, embedded?.address);
  const createEmbedded = async () => {
    if (!authenticated || !user) throw new Error("Log in with Privy first.");
    setError(undefined);
    setCreating(true);
    try {
      if (!embedded) await createWallet();
      setSelection({ userId: user.id, address: "embedded" });
    } finally { setCreating(false); }
  };
  const session: WalletSession = {
    kind: "privy", ready: ready && walletsReady && !creating, available: true, authenticated,
    account: selected?.address ?? null, error,
    wallets: authenticated && walletsReady ? wallets.map((wallet) => ({ address: wallet.address, label: wallet.address.toLowerCase() === embedded?.address.toLowerCase() ? "Privy embedded" : wallet.walletClientType })) : [],
    selectWallet: (address) => {
      if (!user || !authenticated || !walletsReady) return;
      if (address && !wallets.some((wallet) => wallet.address.toLowerCase() === address.toLowerCase())) return;
      setSelection(address ? { userId: user.id, address } : null);
    },
    connectExternal: () => { setError(undefined); connectWallet(); },
    createEmbedded,
    connect: async () => {
      setError(undefined);
      if (!ready || !walletsReady) throw new Error("Privy is still loading. Try again in a moment.");
      if (!authenticated) { login(); return; }
      // Already authenticated: choose a connected signer in the header.
      if (!wallets.length) connectWallet();
    },
    disconnect: async () => { setSelection(null); await logout(); },
    getProvider: async () => {
      if (!selected) throw new Error("Select a connected signing wallet first.");
      await selected.switchChain(MONAD_TESTNET.id);
      return await selected.getEthereumProvider() as Eip1193Provider;
    },
  };
  return <WalletContext.Provider value={session}>{children}</WalletContext.Provider>;
}

export default function PrivyWalletProvider({ appId, children }: { appId: string; children: ReactNode }) {
  return (
    <PrivyProvider appId={appId} config={{
      loginMethods: ["email", "wallet"],
      appearance: { theme: "light", accentColor: "#6D47F5", logo: "/logo-mark.png" },
      embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" }, showWalletUIs: true },
      defaultChain: MONAD_TESTNET,
      supportedChains: [MONAD_TESTNET],
    }}>
      <PrivyWalletBridge>{children}</PrivyWalletBridge>
    </PrivyProvider>
  );
}
