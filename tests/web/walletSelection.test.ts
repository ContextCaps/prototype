import { describe, expect, it } from "vitest";
import { resolveSigningWallet } from "../../apps/web/src/lib/walletSelection";

const metamask = { address: "0xAbCd", kind: "metamask" };
const embedded = { address: "0x1234", kind: "embedded" };

describe("Explicit Privy signing wallet selection", () => {
  it("selects MetaMask even when an embedded wallet is listed first", () => {
    expect(resolveSigningWallet([embedded, metamask], "0xabcd", true, embedded.address)).toBe(metamask);
  });
  it("selects only the embedded wallet for email login", () => {
    expect(resolveSigningWallet([metamask, embedded], "embedded", true, embedded.address)).toBe(embedded);
  });
  it("waits for embedded wallet creation without falling back to MetaMask", () => {
    expect(resolveSigningWallet([metamask], "embedded", true)).toBeNull();
  });
  it("requires an explicit selection when restoring a session", () => {
    expect(resolveSigningWallet([metamask, embedded], null, true, embedded.address)).toBeNull();
  });
  it("does not silently replace a disconnected signer", () => {
    expect(resolveSigningWallet([embedded], metamask.address, true, embedded.address)).toBeNull();
  });
  it("disables a selected wallet after logout, user changes or while SDK loads", () => {
    expect(resolveSigningWallet([metamask], metamask.address, false)).toBeNull();
  });
  it("permits an explicit switch to another connected wallet", () => {
    expect(resolveSigningWallet([metamask, embedded], embedded.address, true)).toBe(embedded);
  });
});
