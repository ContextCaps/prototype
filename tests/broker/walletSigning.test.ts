import { createBrokerApp, createLogger, MockCapabilityStateProvider, sequentialIds, type BrokerApp } from "@contextcaps/broker";
import { runAgentScenario } from "@contextcaps/agent";
import type { CapabilityStateResponse, CreateMandateResponse, PendingMandateResponse } from "@contextcaps/shared-types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MANDATE_VALID_UNTIL, NOW } from "./helpers";

const WALLET_TX = "0x" + "7a".repeat(32);
const MANDATE = {
  principal: "0xA11CE",
  description: "Book my Singapore trip next weekend under $700.",
  constraints: { budgetUsd: 700, destination: "Singapore", validUntil: MANDATE_VALID_UNTIL },
};

/**
 * PRINCIPAL_SIGNING=wallet: the principal's wallet signs root registration and
 * revocation. "The wallet signing" is simulated by writing to the mock trust
 * layer directly, which is what a MetaMask transaction does on Monad.
 */
describe("wallet signing (W01–W08)", () => {
  let app: BrokerApp;
  let provider: MockCapabilityStateProvider;
  let logLines: string[];

  const post = (url: string, payload?: unknown) =>
    app.server.inject({ method: "POST", url, ...(payload === undefined ? {} : { payload: payload as object }) });

  beforeEach(async () => {
    logLines = [];
    const clock = () => NOW;
    provider = new MockCapabilityStateProvider(clock);
    app = await createBrokerApp(
      { receiptKey: "test-key", demoMode: true, corsOrigins: true, chainProvider: "mock", principalSigning: "wallet" },
      { clock, ids: sequentialIds(), logger: createLogger((l) => logLines.push(l)), provider, confirmation: { attempts: 2, delayMs: 1 } },
    );
  });

  afterEach(async () => {
    await app.server.close();
  });

  async function prepare(): Promise<PendingMandateResponse> {
    const res = await post("/api/v1/mandates", MANDATE);
    expect(res.statusCode).toBe(202);
    return res.json();
  }

  async function authorize(): Promise<CreateMandateResponse> {
    const pending = await prepare();
    await provider.registerCapability(pending.capability); // the principal's wallet tx
    const res = await post(`/api/v1/mandates/${pending.mandate.mandateId}/confirm`, { txHash: WALLET_TX });
    expect(res.statusCode).toBe(201);
    return res.json();
  }

  it("W01 POST /mandates prepares an unsigned registration and grants nothing", async () => {
    const pending = await prepare();
    expect(pending.status).toBe("AWAITING_SIGNATURE");
    expect(pending.signRequest).toMatchObject({ to: expect.any(String), data: expect.stringContaining(pending.capability.capabilityId) });
    expect(pending).not.toHaveProperty("session");
    expect(await provider.getCapabilityState(pending.capability.capabilityId)).toBeUndefined();
    expect((await app.server.inject({ method: "GET", url: `/api/v1/capabilities/${pending.capability.capabilityId}` })).statusCode).toBe(404);
    const runs = await post("/api/v1/agent/runs", { mandateId: pending.mandate.mandateId });
    expect(runs.statusCode).toBe(404);
  });

  it("W02 confirm fails closed until the capability is registered on-chain", async () => {
    const pending = await prepare();
    const res = await post(`/api/v1/mandates/${pending.mandate.mandateId}/confirm`, { txHash: WALLET_TX });
    expect(res.statusCode).toBe(409);
    expect(res.json()).not.toHaveProperty("session");
  });

  it("W03 confirm rejects an on-chain registration that differs from the prepared one", async () => {
    const pending = await prepare();
    await provider.registerCapability({ ...pending.capability, policyHash: "0x" + "00".repeat(31) + "01" });
    const res = await post(`/api/v1/mandates/${pending.mandate.mandateId}/confirm`, { txHash: WALLET_TX });
    expect(res.statusCode).toBe(409);
  });

  it("W04 confirm rejects a registration owned by another principal", async () => {
    const pending = await prepare();
    await provider.registerCapability({ ...pending.capability, principal: "0xB0B" });
    const res = await post(`/api/v1/mandates/${pending.mandate.mandateId}/confirm`, { txHash: WALLET_TX });
    expect(res.statusCode).toBe(409);
  });

  it("W05 a confirmed mandate gets a session, records the wallet tx, and runs the golden flow", async () => {
    const created = await authorize();
    expect(created.session.sessionId).toMatch(/^ses_/);
    expect(created.chain.txHash).toBe(WALLET_TX);
    const audit = app.broker.getAudit(created.mandate.mandateId);
    expect(audit.lifecycle[0]).toMatchObject({ type: "MANDATE_CREATED", chainTxHash: WALLET_TX });

    const run = await runAgentScenario(app.broker, { mandate: created.mandate, session: created.session, clock: () => NOW });
    expect(run.status).toBe("BOOKED");
    // Delegation stays broker-signed: the child is registered by the operator under the user's root.
    expect((await provider.getCapabilityState(run.childCapabilityId!))?.parentCapabilityId).toBe(created.capability.capabilityId);

    // A confirmed mandate cannot be confirmed again.
    expect((await post(`/api/v1/mandates/${created.mandate.mandateId}/confirm`, { txHash: WALLET_TX })).statusCode).toBe(404);
  });

  it("W06 the broker never registers a root itself in wallet mode", async () => {
    await expect(app.broker.createMandate(MANDATE)).rejects.toThrow(/wallet signing/);
  });

  it("W07 revocation is recorded only after the principal's wallet revoked on-chain", async () => {
    const created = await authorize();
    const capId = created.capability.capabilityId;

    const prepared = await post(`/api/v1/capabilities/${capId}/revoke/prepare`);
    expect(prepared.statusCode).toBe(200);
    expect(prepared.json().signRequest.data).toContain(capId);

    expect((await post(`/api/v1/capabilities/${capId}/revoke`)).statusCode).toBe(400);
    expect((await post(`/api/v1/capabilities/${capId}/revoke`, { txHash: WALLET_TX })).statusCode).toBe(409);

    await provider.revokeCapability(capId); // the principal's wallet tx
    const res = await post(`/api/v1/capabilities/${capId}/revoke`, { txHash: WALLET_TX });
    expect(res.statusCode).toBe(200);
    const state: CapabilityStateResponse = res.json();
    expect(state.capability.status).toBe("REVOKED");
    expect(state.chain.revocationTxHash).toBe(WALLET_TX);

    const retry = await runAgentScenario(app.broker, { mandate: created.mandate, session: created.session, clock: () => NOW, scenario: "retry" });
    expect(retry).toMatchObject({ status: "HALTED_BY_POLICY", haltReasonCode: "CAPABILITY_REVOKED" });
  });

  it("W08 rejects malformed tx hashes and unknown ids; health reports the signing mode", async () => {
    const pending = await prepare();
    expect((await post(`/api/v1/mandates/${pending.mandate.mandateId}/confirm`, { txHash: "0x123" })).statusCode).toBe(400);
    expect((await post("/api/v1/mandates/mdt_nope/confirm", { txHash: WALLET_TX })).statusCode).toBe(404);
    expect((await post("/api/v1/capabilities/cap_nope/revoke/prepare")).statusCode).toBe(404);
    const health = await app.server.inject({ method: "GET", url: "/api/v1/health" });
    expect(health.json()).toMatchObject({ principalSigning: "wallet" });
    expect(logLines.some((l) => l.includes("mandate.prepared"))).toBe(true);
  });
});
