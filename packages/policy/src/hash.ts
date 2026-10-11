import { createHash, createHmac } from "node:crypto";
import type { ContextCapability } from "@contextcaps/shared-types";

/** Deterministic JSON: object keys sorted recursively, `undefined` fields dropped. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sortDeep(v);
    }
    return out;
  }
  return value;
}

/** 0x-prefixed SHA-256 (32 bytes — fits a Solidity bytes32). */
export function sha256Hex(input: string): string {
  return "0x" + createHash("sha256").update(input).digest("hex");
}

/** Keyed (hiding) commitment — used where the preimage space is small and guessable. */
export function hmacHex(key: string, input: string): string {
  return "0x" + createHmac("sha256", key).update(input).digest("hex");
}

/** Hash over everything that defines a capability's authority (excludes mutable status). */
export function computePolicyHash(capability: Omit<ContextCapability, "policyHash" | "status">): string {
  const { capabilityId, mandateId, principal, agentId, purpose, permissions, parentCapabilityId } = capability;
  const { delegationDepth, maxDelegationDepth, validFrom, expiresAt } = capability;
  return sha256Hex(
    canonicalJson({
      capabilityId,
      mandateId,
      principal,
      agentId,
      purpose,
      permissions,
      parentCapabilityId,
      delegationDepth,
      maxDelegationDepth,
      validFrom,
      expiresAt,
    }),
  );
}
