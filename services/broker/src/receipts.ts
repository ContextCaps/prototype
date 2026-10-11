import { canonicalJson, hmacHex, sha256Hex } from "@contextcaps/policy";
import type { AuditEntry, DisclosureMode, DisclosureReceipt } from "@contextcaps/shared-types";
import type { CapabilityStateProvider } from "./chain/stateProvider";
import type { SafeLogger } from "./logger";
import type { IdGenerator } from "./runtime";
import type { BrokerStore } from "./store";

export interface ReceiptInput {
  kind: AuditEntry["kind"];
  requestId: string;
  mandateId: string;
  capabilityId: string;
  agentId: string;
  resource: string;
  operation: string;
  decision: DisclosureMode;
  reasonCode: string;
  allowed: boolean;
  reason: string;
  /** The full request as submitted — hashed, never stored. */
  requestForHash: unknown;
  /** The disclosed (LLM-visible) result — committed with a keyed hash, never stored. */
  resultForHash?: unknown;
  timestamp: string;
}

/**
 * Builds DisclosureReceipts and anchors them through the trust layer.
 *
 * requestHash = SHA-256(canonical request JSON)
 *   Anyone holding the original request can recompute it.
 *
 * resultHash = HMAC-SHA256(receiptKey, canonical result JSON)
 *   A keyed commitment for sensitive low-entropy derived outputs. Small result
 *   spaces (e.g. {"valid":true}) cannot be brute-forced from anchored data
 *   without the key. It is NOT publicly recomputable: only a verifier holding
 *   RECEIPT_HMAC_KEY (the broker operator, or an auditor it shares the key
 *   with) can check a claimed result against it. Denials carry no resultHash.
 */
export class ReceiptLedger {
  readonly #store: BrokerStore;
  readonly #provider: CapabilityStateProvider;
  readonly #ids: IdGenerator;
  readonly #logger: SafeLogger;
  readonly #receiptKey: string;

  constructor(deps: {
    store: BrokerStore;
    provider: CapabilityStateProvider;
    ids: IdGenerator;
    logger: SafeLogger;
    receiptKey: string;
  }) {
    this.#store = deps.store;
    this.#provider = deps.provider;
    this.#ids = deps.ids;
    this.#logger = deps.logger;
    this.#receiptKey = deps.receiptKey;
  }

  async record(input: ReceiptInput): Promise<DisclosureReceipt> {
    const receipt: DisclosureReceipt = {
      receiptId: this.#ids.next("rcpt"),
      requestId: input.requestId,
      mandateId: input.mandateId,
      capabilityId: input.capabilityId,
      agentId: input.agentId,
      resource: input.resource,
      operation: input.operation,
      decision: input.decision,
      reasonCode: input.reasonCode,
      requestHash: sha256Hex(canonicalJson(input.requestForHash)),
      timestamp: input.timestamp,
    };
    if (input.resultForHash !== undefined) {
      receipt.resultHash = hmacHex(this.#receiptKey, canonicalJson(input.resultForHash));
    }

    try {
      const tx = await this.#provider.anchorDisclosureReceipt(receipt);
      receipt.chainTxHash = tx.txHash;
    } catch {
      // Anchoring is evidence, not authorization: the decision stands, the receipt stays local.
      this.#logger.warn("receipt.anchor_failed", { requestId: receipt.requestId, provider: this.#provider.name });
    }

    this.#store.audit.push({ receipt, allowed: input.allowed, reason: input.reason, kind: input.kind });
    return receipt;
  }
}
