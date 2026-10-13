import { describe, expect, it, vi } from "vitest";
import { sendAndConfirm, type Eip1193Provider } from "../../apps/web/src/lib/wallet";

const principal = "0x" + "11".repeat(20);
const registry = "0x" + "22".repeat(20);
const txHash = "0x" + "ab".repeat(32);
const request = { chainId: 10143, to: registry, data: "0x1234" };

function provider(options: { accounts?: string[]; chain?: string; receiptStatus?: string; rejectSigning?: boolean; refuseSwitch?: boolean; unknownChain?: boolean } = {}) {
  let chain = options.chain ?? "0x279f";
  const call = vi.fn(async ({ method }: { method: string; params?: unknown[] }): Promise<unknown> => {
    switch (method) {
      case "eth_chainId": return chain;
      case "eth_accounts": return options.accounts ?? [principal];
      case "wallet_switchEthereumChain":
        if (options.unknownChain) throw Object.assign(new Error("Unknown network"), { code: 4902 });
        if (!options.refuseSwitch) chain = "0x279f";
        return null;
      case "wallet_addEthereumChain":
        if (!options.refuseSwitch) chain = "0x279f";
        return null;
      case "eth_sendTransaction":
        if (options.rejectSigning) throw Object.assign(new Error("Rejected"), { code: 4001 });
        return txHash;
      case "eth_getTransactionReceipt": return { status: options.receiptStatus ?? "0x1" };
      default: throw new Error(`Unexpected RPC method: ${method}`);
    }
  });
  return { request: call } satisfies Eip1193Provider;
}

describe("Wallet adapter signing for injected and Privy providers", () => {
  it("uses the explicitly supplied provider and original broker calldata", async () => {
    const wallet = provider();
    const stages = vi.fn();
    expect(await sendAndConfirm(principal, request, stages, wallet)).toBe(txHash);
    expect(wallet.request).toHaveBeenCalledWith({ method: "eth_sendTransaction", params: [{ from: principal, to: registry, data: request.data }] });
    expect(stages.mock.calls.map(([stage]) => stage)).toEqual(["sign", "confirm"]);
  });
  it("rejects a changed wallet before sending a transaction", async () => {
    const wallet = provider({ accounts: [registry] });
    await expect(sendAndConfirm(principal, request, vi.fn(), wallet)).rejects.toThrow("signing wallet changed");
    expect(wallet.request.mock.calls.some(([call]) => call.method === "eth_sendTransaction")).toBe(false);
  });
  it("accepts matching addresses regardless of case", async () => {
    const account = "0x" + "ab".repeat(20);
    await expect(sendAndConfirm(account.toUpperCase(), request, vi.fn(), provider({ accounts: [account] }))).resolves.toBe(txHash);
  });
  it("switches to Monad Testnet before signing", async () => {
    const wallet = provider({ chain: "0x1" });
    await sendAndConfirm(principal, request, vi.fn(), wallet);
    expect(wallet.request).toHaveBeenCalledWith({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x279f" }] });
  });
  it("adds the network if absent and then verifies the active chain", async () => {
    const wallet = provider({ chain: "0x1", unknownChain: true });
    await sendAndConfirm(principal, request, vi.fn(), wallet);
    expect(wallet.request.mock.calls.some(([call]) => call.method === "wallet_addEthereumChain")).toBe(true);
  });
  it("does not sign if the provider stays on the wrong chain", async () => {
    const wallet = provider({ chain: "0x1", refuseSwitch: true });
    await expect(sendAndConfirm(principal, request, vi.fn(), wallet)).rejects.toThrow("Switch your wallet to Monad Testnet");
    expect(wallet.request.mock.calls.some(([call]) => call.method === "eth_sendTransaction")).toBe(false);
  });
  it("rejects non-testnet signing requests", async () => {
    const wallet = provider();
    await expect(sendAndConfirm(principal, { ...request, chainId: 143 }, vi.fn(), wallet)).rejects.toThrow("Only Monad Testnet");
    expect(wallet.request).not.toHaveBeenCalled();
  });
  it("reports rejected signatures without confirming a transaction", async () => {
    const wallet = provider({ rejectSigning: true });
    await expect(sendAndConfirm(principal, request, vi.fn(), wallet)).rejects.toThrow("rejected the request");
    expect(wallet.request.mock.calls.some(([call]) => call.method === "eth_getTransactionReceipt")).toBe(false);
  });
  it("rejects reverted transactions", async () => {
    await expect(sendAndConfirm(principal, request, vi.fn(), provider({ receiptStatus: "0x0" }))).rejects.toThrow("reverted");
  });
});
