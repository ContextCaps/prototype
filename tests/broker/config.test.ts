import { loadConfig } from "@contextcaps/broker";
import { describe, expect, it } from "vitest";

describe("broker configuration", () => {
  it("requires a non-blank receipt HMAC key in Monad mode", () => {
    for (const receiptKey of [undefined, "", "   ", "contextcaps-dev-receipt-key"]) {
      expect(() => loadConfig({ CHAIN_PROVIDER: "monad", RECEIPT_HMAC_KEY: receiptKey })).toThrow(
        "RECEIPT_HMAC_KEY must be set when CHAIN_PROVIDER=monad",
      );
    }
  });

  it("accepts an explicit non-blank receipt HMAC key in Monad mode", () => {
    expect(loadConfig({ CHAIN_PROVIDER: "monad", RECEIPT_HMAC_KEY: "test-receipt-hmac-key" }).receiptKey).toBe("test-receipt-hmac-key");
  });

  it("uses BROKER_PORT, then the hosting platform's PORT, then 8787; STATIC_DIR is optional", () => {
    expect(loadConfig({}).port).toBe(8787);
    expect(loadConfig({ PORT: "10000" }).port).toBe(10000);
    expect(loadConfig({ PORT: "10000", BROKER_PORT: "9000" }).port).toBe(9000);
    expect(loadConfig({}).staticDir).toBeUndefined();
    expect(loadConfig({ STATIC_DIR: "apps/web/dist" }).staticDir).toBe("apps/web/dist");
  });

  it("defaults to server signing and only allows wallet signing on Monad", () => {
    expect(loadConfig({}).principalSigning).toBe("server");
    expect(() => loadConfig({ PRINCIPAL_SIGNING: "wallet" })).toThrow("PRINCIPAL_SIGNING=wallet requires CHAIN_PROVIDER=monad");
    expect(loadConfig({ CHAIN_PROVIDER: "monad", RECEIPT_HMAC_KEY: "k", PRINCIPAL_SIGNING: "wallet" }).principalSigning).toBe("wallet");
  });
});
