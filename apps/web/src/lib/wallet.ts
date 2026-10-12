import type { WalletSignRequest } from "../api/types";

/**
 * Minimal EIP-1193 wallet bridge (MetaMask or any injected wallet). The
 * principal's own wallet signs root registration and revocation; the broker
 * only prepares the calldata and verifies the result on-chain.
 */
interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

const MONAD_TESTNET = {
  chainId: 10143,
  chainName: "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: ["https://testnet-rpc.monad.xyz"],
  blockExplorerUrls: ["https://testnet.monadscan.com"],
};

const RECEIPT_TIMEOUT_MS = 120_000;

export const hasWallet = (): boolean => typeof window !== "undefined" && !!window.ethereum;

function wallet(): Eip1193Provider {
  if (!window.ethereum) throw new Error("No wallet found. Install MetaMask to sign on Monad.");
  return window.ethereum;
}

/** Turns wallet RPC errors into messages a person can act on. */
function walletError(e: unknown): Error {
  const code = (e as { code?: number }).code;
  if (code === 4001) return new Error("You rejected the request in your wallet.");
  if (code === -32002) return new Error("Your wallet already has a pending request. Open MetaMask to finish it.");
  return e instanceof Error ? e : new Error(String((e as { message?: string }).message ?? e));
}

export async function connectWallet(): Promise<string> {
  try {
    const accounts = (await wallet().request({ method: "eth_requestAccounts" })) as string[];
    if (!accounts[0]) throw new Error("No wallet account was shared.");
    return accounts[0];
  } catch (e) {
    throw walletError(e);
  }
}

/** Calls `onChange` with the active account (undefined when disconnected). Returns an unsubscribe function. */
export function watchAccount(onChange: (account: string | undefined) => void): () => void {
  const eth = window.ethereum;
  if (!eth?.on) return () => {};
  const listener = (...args: unknown[]) => onChange((args[0] as string[] | undefined)?.[0]);
  eth.on("accountsChanged", listener);
  return () => eth.removeListener?.("accountsChanged", listener);
}

async function ensureChain(chainId: number): Promise<void> {
  const eth = wallet();
  const hexId = `0x${chainId.toString(16)}`;
  if ((await eth.request({ method: "eth_chainId" })) === hexId) return;
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
  } catch (e) {
    if ((e as { code?: number }).code !== 4902 || chainId !== MONAD_TESTNET.chainId) throw walletError(e);
    await eth.request({ method: "wallet_addEthereumChain", params: [{ ...MONAD_TESTNET, chainId: hexId }] });
  }
}

export type TxStage = "sign" | "confirm";

/** Asks the wallet to sign and send `req`, then waits until the tx is mined successfully. Returns its hash. */
export async function sendAndConfirm(from: string, req: WalletSignRequest, onStage: (stage: TxStage) => void): Promise<string> {
  const eth = wallet();
  let hash: string;
  try {
    await ensureChain(req.chainId);
    onStage("sign");
    hash = (await eth.request({ method: "eth_sendTransaction", params: [{ from, to: req.to, data: req.data }] })) as string;
  } catch (e) {
    throw walletError(e);
  }
  onStage("confirm");
  const deadline = Date.now() + RECEIPT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const receipt = (await eth.request({ method: "eth_getTransactionReceipt", params: [hash] })) as { status?: string } | null;
    if (receipt) {
      if (receipt.status !== "0x1") throw new Error("The transaction was reverted on-chain.");
      return hash;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("Timed out waiting for the transaction to be mined.");
}
