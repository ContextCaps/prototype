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
});
