import type { CapabilityStateProvider } from "@contextcaps/broker";
import { computePolicyHash } from "@contextcaps/policy";
import type { ContextCapability, Delegation, DisclosureReceipt } from "@contextcaps/shared-types";
import { describe, expect, it } from "vitest";

/**
 * Conformance suite for any CapabilityStateProvider.
 *
 * Person 1: run this against the Monad-backed provider (local chain or testnet)
 * to prove it is a drop-in replacement for the mock:
 *
 *   runProviderConformance("monad", () => ({ provider: new ContractSdkCapabilityStateProvider(sdkClient) }));
 *
 * `setNow` is optional: supply it only when the backing store's clock can be
 * controlled (mock / local chain with time travel).
 */
export interface ProviderUnderTest {
  provider: CapabilityStateProvider;
  /** Sync clock setters or async EVM time-travel setters are both supported. */
  setNow?: (date: Date) => unknown;
}

const T0 = new Date("2026-10-12T09:00:00Z");

let seq = 0;
function capability(overrides: Partial<ContextCapability> = {}): ContextCapability {
  seq += 1;
  const fields = {
    capabilityId: `cap_conf_${Date.now()}_${seq}`,
    mandateId: "mdt_conf",
    principal: "0xA11CE",
    agentId: "travel-agent",
    purpose: "travel-booking",
    permissions: [{ resource: "calendar.availability", allowedModes: ["DERIVE" as const], delegable: true }],
    delegationDepth: 0,
    maxDelegationDepth: 1,
    validFrom: T0.toISOString(),
    expiresAt: "2026-10-20T00:00:00.000Z",
    ...overrides,
  };
  return { ...fields, status: "ACTIVE", policyHash: computePolicyHash(fields) };
}

export function runProviderConformance(name: string, factory: () => ProviderUnderTest, options: { principal?: () => string } = {}): void {
  const fixture = (overrides: Partial<ContextCapability> = {}) => capability({
    ...(options.principal ? { principal: options.principal() } : {}), ...overrides,
  });
  describe(`CapabilityStateProvider conformance: ${name}`, () => {
    it("register → ACTIVE with the same policy hash and expiry", async () => {
      const { provider } = factory();
      const cap = fixture();
      const tx = await provider.registerCapability(cap);
      expect(tx.txHash).toMatch(/^0x[0-9a-fA-F]+$/);
      const state = await provider.getCapabilityState(cap.capabilityId);
      expect(state).toMatchObject({ capabilityId: cap.capabilityId, status: "ACTIVE", policyHash: cap.policyHash });
      expect(Date.parse(state!.expiresAt)).toBe(Date.parse(cap.expiresAt));
    });

    it("unknown capability → undefined (not an error)", async () => {
      const { provider } = factory();
      expect(await provider.getCapabilityState("cap_does_not_exist")).toBeUndefined();
    });

    it("revoke → REVOKED on the next read", async () => {
      const { provider } = factory();
      const cap = fixture();
      await provider.registerCapability(cap);
      const tx = await provider.revokeCapability(cap.capabilityId);
      expect(tx.txHash).toMatch(/^0x/);
      expect((await provider.getCapabilityState(cap.capabilityId))?.status).toBe("REVOKED");
    });

    it("delegation registers the child with its parent link", async () => {
      const { provider } = factory();
      const parent = fixture();
      await provider.registerCapability(parent);
      const child = fixture({ agentId: "hotel-agent", parentCapabilityId: parent.capabilityId, delegationDepth: 1 });
      const delegation: Delegation = {
        delegationId: `dlg_${child.capabilityId}`,
        mandateId: child.mandateId,
        parentCapabilityId: parent.capabilityId,
        childCapabilityId: child.capabilityId,
        parentAgentId: "travel-agent",
        childAgentId: "hotel-agent",
        purpose: child.purpose,
        createdAt: T0.toISOString(),
      };
      expect((await provider.registerDelegation(delegation, child)).txHash).toMatch(/^0x/);
      const state = await provider.getCapabilityState(child.capabilityId);
      expect(state).toMatchObject({ status: "ACTIVE", parentCapabilityId: parent.capabilityId, policyHash: child.policyHash });
    });

    it("anchoring a receipt returns a transaction hash", async () => {
      const { provider } = factory();
      const cap = fixture();
      await provider.registerCapability(cap);
      const receipt: DisclosureReceipt = {
        receiptId: "rcpt_conf",
        requestId: "req_conf",
        mandateId: cap.mandateId,
        capabilityId: cap.capabilityId,
        agentId: cap.agentId,
        resource: "calendar.availability",
        operation: "available_window",
        decision: "DERIVE",
        reasonCode: "ALLOW_DERIVED",
        requestHash: "0x" + "ab".repeat(32),
        resultHash: "0x" + "cd".repeat(32),
        timestamp: T0.toISOString(),
      };
      expect((await provider.anchorDisclosureReceipt(receipt)).txHash).toMatch(/^0x/);
    });

    it("expiry → EXPIRED once the clock passes expiresAt (when the clock is controllable)", async () => {
      const subject = factory();
      if (!subject.setNow) return;
      const cap = fixture({ expiresAt: "2026-10-13T00:00:00.000Z" });
      await subject.setNow(T0);
      await subject.provider.registerCapability(cap);
      await subject.setNow(new Date("2026-10-13T00:00:00.000Z"));
      expect((await subject.provider.getCapabilityState(cap.capabilityId))?.status).toBe("EXPIRED");
    });
  });
}
