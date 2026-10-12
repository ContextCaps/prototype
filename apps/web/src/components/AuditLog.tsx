import type { AuditResponse } from "../api/types";
import { agentLabel, explorerTxUrl, reasonText, resourceLabel, shortTime, truncate } from "../lib/format";
import { DecisionBadge } from "./DecisionBadge";

/** Disclosure receipts and lifecycle events; hashes and tx links live behind "View proof". */
export function AuditLog({ audit, provider }: { audit: AuditResponse; provider: string | undefined }) {
  const entries = [...audit.entries].sort((a, b) => a.receipt.timestamp.localeCompare(b.receipt.timestamp));
  return (
    <div className="tile">
      <span className="eyebrow">
        <i className="ph ph-receipt" aria-hidden="true" /> {entries.length} receipts · {audit.lifecycle.length} lifecycle events
      </span>
      <ol className="audit">
        {entries.map(({ receipt, reason }) => {
          const txUrl = explorerTxUrl(provider, receipt.chainTxHash);
          return (
            <li key={receipt.receiptId}>
              <details>
                <summary>
                  <time>{shortTime(receipt.timestamp)}</time>
                  <span className="audit-agent">{agentLabel(receipt.agentId)}</span>
                  <span className="audit-res" title={receipt.resource}>{resourceLabel(receipt.resource)}</span>
                  <DecisionBadge decision={receipt.decision} />
                  <span className="audit-reason" title={reason}>{reasonText(receipt.reasonCode)}</span>
                  <span className="audit-proof">View proof <i className="ph ph-caret-down" aria-hidden="true" /></span>
                </summary>
                <dl className="proof">
                  <dt>Receipt</dt><dd><code>{receipt.receiptId}</code></dd>
                  <dt>Capability</dt><dd><code>{receipt.capabilityId}</code></dd>
                  <dt>Request</dt><dd><code>{receipt.resource}</code> · <code>{receipt.operation}</code></dd>
                  <dt>Reason</dt><dd><code>{receipt.reasonCode}</code></dd>
                  <dt>Request hash</dt><dd><code>{receipt.requestHash}</code></dd>
                  <dt>Result commitment</dt><dd><code>{receipt.resultHash ?? "— (denied, nothing released)"}</code></dd>
                  <dt>Anchor tx</dt>
                  <dd>
                    {receipt.chainTxHash ? (
                      txUrl ? <a href={txUrl} target="_blank" rel="noreferrer"><code>{truncate(receipt.chainTxHash, 12, 8)}</code> <i className="ph ph-arrow-up-right" aria-hidden="true" /></a> : <code>{truncate(receipt.chainTxHash, 12, 8)}</code>
                    ) : "—"}
                  </dd>
                </dl>
              </details>
            </li>
          );
        })}
      </ol>
      {audit.lifecycle.length > 0 && (
        <ul className="lifecycle">
          {audit.lifecycle.map((e) => {
            const txUrl = explorerTxUrl(provider, e.chainTxHash);
            return (
              <li key={e.eventId}>
                <time>{shortTime(e.timestamp)}</time>
                <code>{e.type}</code>
                <span>{e.agentId ? agentLabel(e.agentId) : ""} <code>{e.capabilityId}</code></span>
                {e.reasonCode && <span className="muted">{e.reasonCode}</span>}
                {txUrl && <a href={txUrl} target="_blank" rel="noreferrer">tx <i className="ph ph-arrow-up-right" aria-hidden="true" /></a>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
