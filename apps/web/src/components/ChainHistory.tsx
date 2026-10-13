import { useEffect, useState } from "react";
import { envioEnabled, fetchHistory, type IndexedCapability } from "../lib/envio";
import { agentLabel, explorerTxUrl, truncate } from "../lib/format";

const POLL_MS = 5000;

function TxLink({ hash }: { hash: string }) {
  const url = explorerTxUrl("monad", hash);
  return url ? (
    <a href={url} target="_blank" rel="noreferrer">
      <code>{truncate(hash, 8, 6)}</code> <i className="ph ph-arrow-up-right" aria-hidden="true" />
    </a>
  ) : (
    <code>{truncate(hash, 8, 6)}</code>
  );
}

/**
 * What Monad recorded for this principal, read from the Envio indexer rather
 * than from the broker. Polls while mounted so new grants, receipts and
 * revocations appear a few seconds after they are mined.
 */
export function ChainHistory({ principal }: { principal: string }) {
  const [rows, setRows] = useState<IndexedCapability[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!envioEnabled) return;
    let cancelled = false;
    const load = () =>
      fetchHistory(principal).then(
        (data) => !cancelled && (setRows(data), setError(null)),
        (e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)),
      );
    void load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [principal]);

  if (!envioEnabled) return null;

  return (
    <div className="tile chain-history">
      <span className="eyebrow">
        <i className="ph ph-database" aria-hidden="true" /> On-chain history · indexed by Envio
      </span>
      <p className="muted small">
        Read straight from Monad events for <code>{truncate(principal, 6, 4)}</code>, independent of the broker. It survives broker restarts.
      </p>
      {error && <p className="callout callout-warn"><i className="ph ph-warning" aria-hidden="true" /> Indexer unavailable: {error}</p>}
      {!error && rows === null && <p className="muted small">Loading indexed history…</p>}
      {rows && rows.length === 0 && <p className="muted small">No grants indexed for this wallet yet. New transactions appear within a few seconds.</p>}
      {rows && rows.length > 0 && (
        <ol className="chain-list">
          {rows.map((cap) => (
            <li key={cap.id} className={cap.depth > 0 ? "is-child" : undefined}>
              <div className="chain-row">
                <span className="chain-agent">{agentLabel(cap.agent)}</span>
                <span className={`status status-${cap.status.toLowerCase()}`}>{cap.status}</span>
                <span className="muted small">
                  {cap.receiptCount} receipts{cap.denyCount > 0 ? ` · ${cap.denyCount} blocked` : ""}
                </span>
                <span className="chain-tx small">
                  grant <TxLink hash={cap.registeredTx} />
                  {cap.revokedTx && <> · revoke <TxLink hash={cap.revokedTx} /></>}
                </span>
              </div>
              {cap.receipts.length > 0 && (
                <div className="chain-receipts">
                  {cap.receipts.map((r) => (
                    <a
                      key={r.id}
                      className={`chain-receipt is-${r.decision.toLowerCase().replace("_", "-")}`}
                      href={explorerTxUrl("monad", r.txHash)}
                      target="_blank"
                      rel="noreferrer"
                      title={`${r.decision} receipt ${r.id}`}
                    >
                      {r.decision === "TOOL_BOUND" ? "TOOL" : r.decision}
                    </a>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
