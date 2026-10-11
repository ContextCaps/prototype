import { canonicalJson, sha256Hex } from "@contextcaps/policy";

export type QuotaAdmission = { kind: "cached"; result: unknown } | { kind: "admitted" } | { kind: "exhausted" };

/**
 * Unique-query quota for low-entropy derived facts.
 *
 * A boolean like passport.validity can be turned into an oracle by probing many
 * date ranges (binary search on the expiry date). Each capability may ask at
 * most N *distinct* questions per resource; repeating an identical question
 * returns the cached answer and costs nothing. Scope: capability + resource.
 * Limits come from the server-side resource catalog — never from the request.
 */
export class DerivationQuota {
  readonly #answers = new Map<string, Map<string, unknown>>();

  static queryKey(operation: string, parameters: Record<string, unknown>): string {
    return sha256Hex(canonicalJson({ operation, parameters }));
  }

  admit(capabilityId: string, resource: string, queryKey: string, limit: number): QuotaAdmission {
    const answers = this.#answers.get(scope(capabilityId, resource));
    if (answers?.has(queryKey)) return { kind: "cached", result: structuredClone(answers.get(queryKey)) };
    if ((answers?.size ?? 0) >= limit) return { kind: "exhausted" };
    return { kind: "admitted" };
  }

  record(capabilityId: string, resource: string, queryKey: string, result: unknown): void {
    const key = scope(capabilityId, resource);
    const answers = this.#answers.get(key) ?? new Map<string, unknown>();
    answers.set(queryKey, structuredClone(result));
    this.#answers.set(key, answers);
  }

  used(capabilityId: string, resource: string): number {
    return this.#answers.get(scope(capabilityId, resource))?.size ?? 0;
  }

  reset(): void {
    this.#answers.clear();
  }
}

function scope(capabilityId: string, resource: string): string {
  return `${capabilityId}\u0000${resource}`;
}
