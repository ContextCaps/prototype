import { RESOURCES } from "@contextcaps/shared-types";
import { beforeEach, describe, expect, it } from "vitest";
import { makeHarness, passportValidityAsk, type Harness } from "./helpers";

describe("Derived-query quota (passport.validity: 5 unique queries per capability)", () => {
  let h: Harness;
  let mandate: Awaited<ReturnType<Harness["createTravelMandate"]>>;

  /** Distinct passport-validity questions differing only in the departure date. */
  const query = (day: number) => ({
    ...passportValidityAsk,
    parameters: { ...passportValidityAsk.parameters, departureDate: `2026-11-${String(day).padStart(2, "0")}`, returnDate: "2026-11-28" },
  });
  const ask = (sessionId: string, day: number) => h.broker.requestContextForSession(sessionId, query(day));

  beforeEach(async () => {
    h = makeHarness();
    mandate = await h.createTravelMandate();
  });

  it("Q01 identical query repeated → same cached result, one slot used", async () => {
    const first = await ask(mandate.session.sessionId, 1);
    for (let i = 0; i < 10; i++) {
      const again = await ask(mandate.session.sessionId, 1);
      expect(again).toMatchObject({ decision: "DERIVE", allowed: true, result: first.result });
    }
    // Four more distinct questions still fit (1 + 4 = 5).
    for (const day of [2, 3, 4, 5]) expect((await ask(mandate.session.sessionId, day)).allowed).toBe(true);
  });

  it("Q02 + Q03 distinct queries count; the 6th distinct query → DENY DERIVATION_QUOTA_EXCEEDED", async () => {
    for (const day of [1, 2, 3, 4, 5]) expect((await ask(mandate.session.sessionId, day)).allowed).toBe(true);
    const sixth = await ask(mandate.session.sessionId, 6);
    expect(sixth).toMatchObject({ decision: "DENY", allowed: false, reasonCode: "DERIVATION_QUOTA_EXCEEDED" });
    expect(sixth.result).toBeUndefined();
    // Previously asked questions keep answering from cache.
    expect((await ask(mandate.session.sessionId, 3)).allowed).toBe(true);
    // Every attempt was receipted, including the denial.
    const entries = h.broker.getAudit(mandate.mandate.mandateId).entries;
    expect(entries.filter((e) => e.receipt.reasonCode === "DERIVATION_QUOTA_EXCEEDED")).toHaveLength(1);
  });

  it("Q04 a different capability has an independent quota", async () => {
    for (const day of [1, 2, 3, 4, 5, 6]) await ask(mandate.session.sessionId, day);
    const other = await h.createTravelMandate();
    expect((await ask(other.session.sessionId, 6)).allowed).toBe(true);
  });

  it("Q05 a revoked capability stays denied regardless of quota or cache", async () => {
    await ask(mandate.session.sessionId, 1);
    await h.broker.revokeCapability(mandate.capability.capabilityId);
    const cached = await ask(mandate.session.sessionId, 1);
    expect(cached).toMatchObject({ allowed: false, reasonCode: "CAPABILITY_REVOKED" });
    expect(cached.result).toBeUndefined();
  });

  it("rejected (malformed / off-task) queries do not consume quota", async () => {
    for (let i = 0; i < 6; i++) {
      await h.broker.requestContextForSession(mandate.session.sessionId, {
        ...passportValidityAsk,
        parameters: { ...passportValidityAsk.parameters, destination: "Japan" },
      });
    }
    for (const day of [1, 2, 3, 4, 5]) expect((await ask(mandate.session.sessionId, day)).allowed).toBe(true);
  });

  it("calendar.availability has its own (larger) unique-query limit", async () => {
    const window = (day: number) => ({
      resource: RESOURCES.CALENDAR_AVAILABILITY,
      operation: "available_window",
      parameters: { from: `2026-11-${String(day).padStart(2, "0")}T00:00:00Z`, to: `2026-11-${String(day + 1).padStart(2, "0")}T00:00:00Z` },
    });
    for (let day = 1; day <= 10; day++) {
      expect((await h.broker.requestContextForSession(mandate.session.sessionId, window(day))).allowed).toBe(true);
    }
    const eleventh = await h.broker.requestContextForSession(mandate.session.sessionId, window(11));
    expect(eleventh.reasonCode).toBe("DERIVATION_QUOTA_EXCEEDED");
  });
});
