import { randomBytes } from "node:crypto";

export type Clock = () => Date;

export const systemClock: Clock = () => new Date();

export interface IdGenerator {
  next(prefix: string): string;
}

export const randomIds: IdGenerator = {
  next: (prefix) => `${prefix}_${randomBytes(8).toString("hex")}`,
};

/** Deterministic ids for tests and demo resets: cap_0001, cap_0002, ... */
export function sequentialIds(): IdGenerator & { reset(): void } {
  const counters = new Map<string, number>();
  return {
    next(prefix) {
      const n = (counters.get(prefix) ?? 0) + 1;
      counters.set(prefix, n);
      return `${prefix}_${String(n).padStart(4, "0")}`;
    },
    reset() {
      counters.clear();
    },
  };
}

/** Unguessable bearer value for tool-bound handles. Never sequential. */
export function secretHandleId(): string {
  return `tbh_${randomBytes(16).toString("hex")}`;
}
