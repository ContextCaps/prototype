import { ContextBroker, ContractSdkCapabilityStateProvider, MockBookingConnector, sequentialIds, type ContractClientLike } from "@contextcaps/broker";
import { AGENT_IDS } from "@contextcaps/shared-types";
import { ContextVault } from "@contextcaps/vault";
import { describe, expect, it } from "vitest";
import { availabilityAsk, MANDATE_VALID_UNTIL, NOW } from "./helpers";

/** Fake of Person 1's SDK, used to verify the adapter mapping until the real SDK lands. */
function fakeClient() {
  const caps = new Map<string, { capabilityId: string; status: "ACTIVE" | "REVOKED"; policyHash: string; expiresAt: string }>();
  const calls: string[] = [];
  const anchors: Array<{ decisionCode: number; resultHash: string }> = [];
  let n = 0;
  const tx = () => ({ txHash: `0x${(++n).toString(16).padStart(64, "0")}` });
  const client: ContractClientLike = {
    async registerCapability(input) {
      calls.push(`register:${input.capabilityId}:${input.parentCapabilityId ?? "-"}`);
      caps.set(input.capabilityId, { capabilityId: input.capabilityId, status: "ACTIVE", policyHash: input.policyHash, expiresAt: input.expiresAt });
      return tx();
    },
    async revokeCapability(id) {
      calls.push(`revoke:${id}`);
      caps.get(id)!.status = "REVOKED";
      return tx();
    },
    async getCapability(id) {
      return caps.get(id) ?? null;
    },
    async isCapabilityActive(id) {
      return caps.get(id)?.status === "ACTIVE";
    },
    async registerDelegation(input) {
      calls.push(`delegate:${input.parentCapabilityId}->${input.childCapabilityId}`);
      return tx();
    },
    async anchorDisclosureReceipt(r) {
      anchors.push({ decisionCode: r.decisionCode, resultHash: r.resultHash });
      return tx();
    },
    encodeRegisterCapability(input) {
      return { to: "0xregistry", data: `register:${input.capabilityId}` };
    },
    encodeRevokeCapability(id) {
      return { to: "0xregistry", data: `revoke:${id}` };
    },
  };
  return { client, calls, anchors };
}

describe("ContractSdkCapabilityStateProvider (adapter for Person 1's SDK)", () => {
  it("drives register / anchor / revoke through the SDK and enforces on-chain revocation", async () => {
    const { client, calls, anchors } = fakeClient();
    const broker = new ContextBroker({
      vault: new ContextVault(),
      provider: new ContractSdkCapabilityStateProvider(client),
      connectors: [new MockBookingConnector()],
      receiptKey: "k",
      clock: () => NOW,
      ids: sequentialIds(),
    });
    const m = await broker.createMandate({
      principal: "0xA11CE",
      description: "trip",
      constraints: { destination: "Singapore", budgetUsd: 700, validUntil: MANDATE_VALID_UNTIL },
    });
    const req = {
      requestId: "r1",
      mandateId: m.mandate.mandateId,
      capabilityId: m.capability.capabilityId,
      agentId: AGENT_IDS.TRAVEL,
      purpose: m.mandate.purpose,
      timestamp: NOW.toISOString(),
      ...availabilityAsk,
    };
    expect((await broker.requestContext(req)).allowed).toBe(true);
    expect(anchors.at(-1)).toMatchObject({ decisionCode: 1 });

    await client.revokeCapability(m.capability.capabilityId); // e.g. user revoked from the web wallet
    const denied = await broker.requestContext({ ...req, requestId: "r2" });
    expect(denied.reasonCode).toBe("CAPABILITY_REVOKED");
    expect(anchors.at(-1)).toMatchObject({ decisionCode: 0, resultHash: "0x" + "0".repeat(64) });
    expect(calls[0]).toBe(`register:${m.capability.capabilityId}:-`);
  });
});
