import ganache from "ganache";
import { BrowserProvider, ContractFactory, ZeroHash, type JsonRpcSigner } from "ethers";
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { compileRegistry } from "../../packages/contracts/scripts/compile";
import { ContextCapsContractClient, toBytes32Id } from "@contextcaps/contract-sdk";
import { ContractSdkCapabilityStateProvider } from "../../services/broker/src/chain/contractSdkProvider";
import { runProviderConformance } from "../broker/providerConformance";
import { createBrokerApp } from "../../services/broker/src/app";
import { runAgentScenario } from "@contextcaps/agent";
import { silentLogger } from "../../services/broker/src/logger";
import { findLeakedSecrets } from "../broker/helpers";

const T0 = new Date("2026-10-12T09:00:00Z");
const HASH = "0x" + "ab".repeat(32);
const END = "2026-10-20T00:00:00.000Z";
const artifact = compileRegistry();
let chain: ReturnType<typeof ganache.provider>;
let provider: BrowserProvider;
let signer: JsonRpcSigner;
let stranger: JsonRpcSigner;
let writer: JsonRpcSigner;
let sdk: ContextCapsContractClient;
let strangerSdk: ContextCapsContractClient;
let writerSdk: ContextCapsContractClient;
let principal: string;
let address: string;

beforeAll(async () => {
  chain = ganache.provider({ logging: { quiet: true }, chain: { time: T0, hardfork: "shanghai" }, wallet: { totalAccounts: 3 } });
  provider = new BrowserProvider(chain, undefined, { cacheTimeout: -1 });
  provider.pollingInterval = 10;
  signer = await provider.getSigner(0);
  stranger = await provider.getSigner(1);
  writer = await provider.getSigner(2);
  principal = await signer.getAddress();
});
afterAll(async () => { provider.destroy(); await chain.disconnect(); });
beforeEach(async () => {
  await chain.request({ method: "evm_setTime", params: [T0.getTime()] });
  const deployed = await new ContractFactory(artifact.abi, artifact.bytecode, signer).deploy(await writer.getAddress());
  await deployed.waitForDeployment();
  address = await deployed.getAddress();
  sdk = new ContextCapsContractClient({ address, runner: signer, explorerUrl: "https://testnet.monadscan.com" });
  strangerSdk = new ContextCapsContractClient({ address, runner: stranger });
  writerSdk = new ContextCapsContractClient({ address, runner: writer });
});
function register(id = "cap_root", parentCapabilityId?: string, expiresAt = END) {
  return sdk.registerCapability({ capabilityId: id, principal, agentId: parentCapabilityId ? "hotel-agent" : "travel-agent",
    policyHash: HASH, expiresAt, parentCapabilityId });
}
function anchor(receiptId = "rcpt_1", decisionCode = 1) {
  return { receiptId, capabilityId: "cap_root", requestHash: HASH, resultHash: ZeroHash, decisionCode };
}

describe("CapabilityRegistry + real SDK on local EVM", () => {
  it("registers and queries canonical IDs, policy, expiry and tx proof", async () => {
    expect(await sdk.getCapability("unknown")).toBeNull();
    expect(await sdk.isCapabilityActive("unknown")).toBe(false);
    const tx = await register();
    expect(tx.explorerUrl).toBe(`https://testnet.monadscan.com/tx/${tx.txHash}`);
    expect(await sdk.getCapability("cap_root")).toMatchObject({ capabilityId: "cap_root", principal, policyHash: HASH, expiresAt: END, status: "ACTIVE" });
    expect(await sdk.isCapabilityActive("cap_root")).toBe(true);
    await expect(register()).rejects.toThrow();
  });
  it("only the principal can register, revoke or complete", async () => {
    await expect(strangerSdk.registerCapability({ capabilityId: "fake", principal, agentId: "travel-agent", policyHash: HASH, expiresAt: END })).rejects.toThrow();
    await register();
    await expect(strangerSdk.revokeCapability("cap_root")).rejects.toThrow();
    await expect(writerSdk.revokeCapability("cap_root")).rejects.toThrow();
    await expect(strangerSdk.completeCapability("cap_root")).rejects.toThrow();
    await sdk.revokeCapability("cap_root");
    expect((await sdk.getCapability("cap_root"))?.status).toBe("REVOKED");
    expect(await sdk.isCapabilityActive("cap_root")).toBe(false);
  });
  it("the operator may register children under an active root, but never roots, and cannot revoke", async () => {
    const asOperator = (id: string, parentCapabilityId?: string, expiresAt = END) =>
      writerSdk.registerCapability({ capabilityId: id, principal, agentId: "hotel-agent", policyHash: HASH, parentCapabilityId, expiresAt });
    await expect(asOperator("op_root")).rejects.toThrow();
    await register();
    await asOperator("op_child", "cap_root");
    await writerSdk.registerDelegation({ parentCapabilityId: "cap_root", childCapabilityId: "op_child", childAgentId: "hotel-agent" });
    expect(await sdk.getCapability("op_child")).toMatchObject({ principal, parentCapabilityId: "cap_root", status: "ACTIVE" });
    await expect(asOperator("op_long", "cap_root", "2026-10-21T00:00:00Z")).rejects.toThrow();
    await expect(writerSdk.revokeCapability("op_child")).rejects.toThrow();
    await expect(strangerSdk.registerCapability({ capabilityId: "x_child", principal, agentId: "hotel-agent", policyHash: HASH, parentCapabilityId: "cap_root", expiresAt: END })).rejects.toThrow();
    await sdk.revokeCapability("cap_root");
    expect((await sdk.getCapability("op_child"))?.status).toBe("REVOKED");
    await expect(asOperator("op_late", "cap_root")).rejects.toThrow();
  });
  it("expires at the exact boundary and never extends fractional expiry", async () => {
    await register("cap_root", undefined, "2026-10-13T00:00:00.999Z");
    expect((await sdk.getCapability("cap_root"))?.expiresAt).toBe("2026-10-13T00:00:00.000Z");
    await chain.request({ method: "evm_setTime", params: [Date.parse("2026-10-13T00:00:00Z")] });
    await chain.request({ method: "evm_mine", params: [] });
    expect((await sdk.getCapability("cap_root"))?.status).toBe("EXPIRED");
    expect(await sdk.isCapabilityActive("cap_root")).toBe(false);
    await expect(register("past", undefined, "2026-10-13T00:00:00Z")).rejects.toThrow();
  });
  it("completion is terminal and deactivates descendants", async () => {
    await register(); await register("cap_child", "cap_root");
    await sdk.completeCapability("cap_root");
    expect((await sdk.getCapability("cap_child"))?.status).toBe("COMPLETED");
    await expect(sdk.revokeCapability("cap_root")).rejects.toThrow();
    await expect(register()).rejects.toThrow();
  });
  it("delegation matches immutable parent/agent and survives a fresh SDK instance", async () => {
    await register(); await register("cap_child", "cap_root");
    await expect(sdk.registerDelegation({ parentCapabilityId: "wrong", childCapabilityId: "cap_child", childAgentId: "hotel-agent" })).rejects.toThrow();
    await expect(sdk.registerDelegation({ parentCapabilityId: "cap_root", childCapabilityId: "cap_child", childAgentId: "travel-agent" })).rejects.toThrow();
    await sdk.registerDelegation({ parentCapabilityId: "cap_root", childCapabilityId: "cap_child", childAgentId: "hotel-agent" });
    expect(await strangerSdk.getCapability("cap_child")).toMatchObject({ parentCapabilityId: "cap_root", status: "ACTIVE" });
    expect(await sdk.contract.getFunction("delegationRegistered")(toBytes32Id("cap_child"))).toBe(true);
    await register("cap_grandchild", "cap_child");
    await sdk.revokeCapability("cap_root");
    expect((await sdk.getCapability("cap_grandchild"))?.status).toBe("REVOKED");
    await expect(register("late_child", "cap_root")).rejects.toThrow();
  });
  it("rejects delegation with foreign principal, extended expiry, or excessive depth", async () => {
    await register();
    await expect(strangerSdk.registerCapability({ capabilityId: "foreign", principal: await stranger.getAddress(), agentId: "hotel-agent", policyHash: HASH, parentCapabilityId: "cap_root", expiresAt: END })).rejects.toThrow();
    await expect(register("long", "cap_root", "2026-10-21T00:00:00Z")).rejects.toThrow();
    let parent = "cap_root";
    for (let n = 1; n <= 8; n++) { await register(`child_${n}`, parent); parent = `child_${n}`; }
    await expect(register("too_deep", parent)).rejects.toThrow();
  });
  it("anchors immutable receipts, emits proof, and permits DENY after revoke", async () => {
    await register();
    await expect(strangerSdk.anchorDisclosureReceipt(anchor())).rejects.toThrow();
    const tx = await writerSdk.anchorDisclosureReceipt(anchor());
    const receipt = await provider.getTransactionReceipt(tx.txHash);
    const event = sdk.contract.interface.parseLog(receipt!.logs[0]!);
    expect(event?.name).toBe("DisclosureReceiptAnchored");
    expect(event?.args.receiptId).toBe(toBytes32Id("rcpt_1"));
    expect((await sdk.contract.getFunction("receipts")(toBytes32Id("rcpt_1"))).exists).toBe(true);
    await expect(writerSdk.anchorDisclosureReceipt(anchor())).rejects.toThrow();
    await sdk.revokeCapability("cap_root");
    await expect(writerSdk.anchorDisclosureReceipt(anchor("allow_after_revoke"))).rejects.toThrow();
    await writerSdk.anchorDisclosureReceipt(anchor("deny_after_revoke", 0));
    await expect(sdk.contract.getFunction("anchorDisclosureReceipt")(toBytes32Id("bad"), toBytes32Id("cap_root"), HASH, ZeroHash, 4)).rejects.toThrow();
  });
  it("round trips the existing Person 2 adapter including child revocation", async () => {
    const state = new ContractSdkCapabilityStateProvider(sdk);
    const cap = { capabilityId: "cap_adapter", mandateId: "mdt_1", principal, agentId: "travel-agent", purpose: "travel-booking",
      permissions: [], delegationDepth: 0, maxDelegationDepth: 1, validFrom: T0.toISOString(), expiresAt: END, status: "ACTIVE" as const, policyHash: HASH };
    await state.registerCapability(cap);
    await state.registerDelegation({ delegationId: "dlg_1", mandateId: "mdt_1", parentCapabilityId: cap.capabilityId,
      childCapabilityId: "cap_adapter_child", parentAgentId: "travel-agent", childAgentId: "hotel-agent", purpose: cap.purpose, createdAt: T0.toISOString() },
      { ...cap, capabilityId: "cap_adapter_child", parentCapabilityId: cap.capabilityId, agentId: "hotel-agent", delegationDepth: 1 });
    expect(await state.getCapabilityState("cap_adapter_child")).toMatchObject({ status: "ACTIVE", parentCapabilityId: cap.capabilityId });
    await state.revokeCapability(cap.capabilityId);
    expect((await state.getCapabilityState("cap_adapter_child"))?.status).toBe("REVOKED");
    expect(await state.getCapabilityState("unknown")).toBeUndefined();
  });
  it("validates SDK IDs, hashes, timestamps and decision codes before sending", async () => {
    expect(() => toBytes32Id("")).toThrow();
    expect(() => toBytes32Id("a".repeat(129))).toThrow();
    expect(() => sdk.registerCapability({ capabilityId: "cap", principal, agentId: "agent", policyHash: "bad", expiresAt: END })).toThrow();
    expect(() => sdk.registerCapability({ capabilityId: "cap", principal, agentId: "agent", policyHash: HASH, expiresAt: "bad" })).toThrow();
    expect(() => sdk.anchorDisclosureReceipt(anchor("bad", -1))).toThrow();
  });
  it("handles concurrent writes and recovers the queue after a reverted transaction", async () => {
    await Promise.all([register("cap_a"), register("cap_b")]);
    const results = await Promise.allSettled([register("cap_a"), register("cap_c")]);
    expect(results[0]?.status).toBe("rejected");
    expect(results[1]?.status).toBe("fulfilled");
    expect(await sdk.isCapabilityActive("cap_c")).toBe(true);
  });
  it("throws on RPC read failure so the broker cannot fall back to ACTIVE", async () => {
    await register();
    const failedRead = vi.spyOn(provider, "getBlock").mockRejectedValueOnce(new Error("RPC unavailable"));
    try { await expect(sdk.getCapability("cap_root")).rejects.toThrow("RPC unavailable"); }
    finally { failedRead.mockRestore(); }
  });
  it("runs the full agent → broker → SDK → EVM booking, proof and direct-chain revoke flow", async () => {
    const app = await createBrokerApp({ chainProvider: "monad", receiptKey: "local-evm-test-key", demoMode: false, corsOrigins: true },
      { provider: new ContractSdkCapabilityStateProvider(sdk), clock: () => T0, logger: silentLogger });
    try {
      const created = await app.broker.createMandate({ principal, description: "Book my Singapore trip next weekend under $700.",
        constraints: { budgetUsd: 700, destination: "Singapore" } });
      const result = await runAgentScenario(app.broker, { mandate: created.mandate, session: created.session, clock: () => T0 });
      expect(result.status).toBe("BOOKED");
      expect(findLeakedSecrets(result)).toEqual([]);
      expect((await sdk.getCapability(result.childCapabilityId!))?.parentCapabilityId).toBe(created.capability.capabilityId);
      const audit = app.broker.getAudit(created.mandate.mandateId);
      expect(audit.entries.length).toBeGreaterThan(8);
      for (const entry of audit.entries) {
        expect(entry.receipt.chainTxHash).toMatch(/^0x[0-9a-f]{64}$/);
        expect((await sdk.contract.getFunction("receipts")(toBytes32Id(entry.receipt.receiptId))).exists).toBe(true);
      }
      // Revoke directly on chain, bypassing broker memory; its next read must enforce it.
      await sdk.revokeCapability(created.capability.capabilityId);
      const retry = await runAgentScenario(app.broker, { mandate: created.mandate, session: created.session, clock: () => T0, scenario: "retry" });
      expect(retry).toMatchObject({ status: "HALTED_BY_POLICY", haltReasonCode: "CAPABILITY_REVOKED" });
      expect((await sdk.getCapability(result.childCapabilityId!))?.status).toBe("REVOKED");
    } finally { await app.server.close(); }
  }, 30_000);
  it("wallet signing: the user's wallet registers and revokes, the broker operator runs everything else", async () => {
    const chainId = Number((await provider.getNetwork()).chainId);
    const app = await createBrokerApp(
      { chainProvider: "monad", principalSigning: "wallet", receiptKey: "local-evm-test-key", demoMode: false, corsOrigins: true },
      { provider: new ContractSdkCapabilityStateProvider(writerSdk, { chainId }), clock: () => T0, logger: silentLogger, confirmation: { attempts: 3, delayMs: 10 } });
    try {
      const pending = app.broker.prepareMandate({ principal, description: "Book my Singapore trip next weekend under $700.",
        constraints: { budgetUsd: 700, destination: "Singapore" } });
      expect(pending.signRequest).toMatchObject({ chainId, to: address });
      const userTx = await signer.sendTransaction(pending.signRequest);
      await userTx.wait();
      const created = (await app.broker.confirmMandate(pending.mandate.mandateId, userTx.hash))!;
      expect(created.chain.txHash).toBe(userTx.hash);

      const result = await runAgentScenario(app.broker, { mandate: created.mandate, session: created.session, clock: () => T0 });
      expect(result.status).toBe("BOOKED");
      expect(await sdk.getCapability(result.childCapabilityId!)).toMatchObject({ principal, parentCapabilityId: created.capability.capabilityId });

      const revocation = app.broker.prepareRevocation(created.capability.capabilityId)!;
      await expect(app.broker.revokeCapability(created.capability.capabilityId, userTx.hash)).rejects.toThrow(/not revoked/);
      const revokeTx = await signer.sendTransaction(revocation.signRequest);
      await revokeTx.wait();
      const state = await app.broker.revokeCapability(created.capability.capabilityId, revokeTx.hash);
      expect(state?.capability.status).toBe("REVOKED");
      const retry = await runAgentScenario(app.broker, { mandate: created.mandate, session: created.session, clock: () => T0, scenario: "retry" });
      expect(retry).toMatchObject({ status: "HALTED_BY_POLICY", haltReasonCode: "CAPABILITY_REVOKED" });
    } finally { await app.server.close(); }
  }, 30_000);
});

runProviderConformance("real Contract SDK / local EVM", () => ({
  provider: new ContractSdkCapabilityStateProvider(sdk),
  setNow: async (date) => {
    await chain.request({ method: "evm_setTime", params: [date.getTime()] });
    await chain.request({ method: "evm_mine", params: [] });
  },
}), { principal: () => principal });
