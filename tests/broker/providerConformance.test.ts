import { ContractSdkCapabilityStateProvider, MockCapabilityStateProvider, toBytes32Id, type ContractClientLike } from "@contextcaps/broker";
import type { CapabilityStatus } from "@contextcaps/shared-types";
import { describe, expect, it } from "vitest";
import { runProviderConformance } from "./providerConformance";

/**
 * In-memory stand-in for Person 1's SDK that behaves like the contract:
 * string IDs in, bytes32 keys internally (via toBytes32Id), expiry by clock.
 */
function fakeSdk(clock: () => Date): ContractClientLike {
  type Row = { capabilityId: string; status: CapabilityStatus; policyHash: string; parentCapabilityId?: string; expiresAt: string };
  const rows = new Map<string, Row>();
  let n = 0;
  const tx = () => ({ txHash: `0x${(++n).toString(16).padStart(64, "0")}` });
  return {
    async registerCapability(input) {
      rows.set(toBytes32Id(input.capabilityId), { ...input, status: "ACTIVE" });
      return tx();
    },
    async revokeCapability(id) {
      const row = rows.get(toBytes32Id(id));
      if (!row) throw new Error("not registered");
      row.status = "REVOKED";
      return tx();
    },
    async getCapability(id) {
      const row = rows.get(toBytes32Id(id));
      if (!row) return null;
      const expired = row.status === "ACTIVE" && clock().getTime() >= Date.parse(row.expiresAt);
      return { ...row, status: expired ? "EXPIRED" : row.status };
    },
    async isCapabilityActive(id) {
      return (await this.getCapability(id))?.status === "ACTIVE";
    },
    async registerDelegation() {
      return tx();
    },
    async anchorDisclosureReceipt() {
      return tx();
    },
    encodeRegisterCapability(input) {
      return { to: "0xregistry", data: `register:${input.capabilityId}` };
    },
    encodeRevokeCapability(id) {
      return { to: "0xregistry", data: `revoke:${id}` };
    },
  };
}

runProviderConformance("mock", () => {
  let now = new Date("2026-10-12T09:00:00Z");
  return { provider: new MockCapabilityStateProvider(() => now), setNow: (d) => (now = d) };
});

runProviderConformance("contract-sdk adapter (fake SDK)", () => {
  let now = new Date("2026-10-12T09:00:00Z");
  return { provider: new ContractSdkCapabilityStateProvider(fakeSdk(() => now)), setNow: (d) => (now = d) };
});

describe("toBytes32Id (adapter-level ID encoding)", () => {
  it("is keccak256(UTF-8(id)) as 0x-prefixed 32 bytes", () => {
    // Standard keccak256 test vectors.
    expect(toBytes32Id("")).toBe("0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
    expect(toBytes32Id("hello")).toBe("0x1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8");
    expect(toBytes32Id("cap_0001")).toMatch(/^0x[0-9a-f]{64}$/);
    expect(toBytes32Id("cap_0001")).not.toBe(toBytes32Id("cap_0002"));
  });
});
