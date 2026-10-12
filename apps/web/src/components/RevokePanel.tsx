import type { AgentRunResult, CapabilityStateResponse } from "../api/types";
import { agentLabel, explorerTxUrl, reasonText, truncate } from "../lib/format";
import { ActivityFeed } from "./ActivityFeed";
import { StatusBadge } from "./DecisionBadge";

interface Props {
  provider: string | undefined;
  root: CapabilityStateResponse;
  child: CapabilityStateResponse | null;
  retry: AgentRunResult | null;
  busy: "revoke" | "retry" | null;
  onRevoke: () => void;
  onRetry: () => void;
}

export function RevokePanel({ provider, root, child, retry, busy, onRevoke, onRetry }: Props) {
  const revoked = root.capability.status === "REVOKED";
  const revocationTx = root.chain.revocationTxHash;
  const txUrl = explorerTxUrl(provider, revocationTx);

  return (
    <div className={`tile tile-revoke${revoked ? " is-revoked" : ""}`}>
      <div className="revoke-row">
        <ul className="cap-list">
          {[root, child].filter((s): s is CapabilityStateResponse => !!s).map((s) => (
            <li key={s.capability.capabilityId}>
              <span>{agentLabel(s.capability.agentId)}</span>
              <code>{s.capability.capabilityId}</code>
              <StatusBadge status={s.capability.status} />
            </li>
          ))}
        </ul>
        <div className="revoke-actions">
          {!revoked ? (
            <button type="button" className="btn btn-danger" onClick={onRevoke} disabled={!!busy}>
              <i className="ph ph-hand-palm" aria-hidden="true" />
              {busy === "revoke" ? "Revoking…" : "Revoke Access"}
            </button>
          ) : (
            <button type="button" className="btn btn-ghost" onClick={onRetry} disabled={!!busy}>
              <i className="ph ph-arrow-clockwise" aria-hidden="true" />
              {busy === "retry" ? "Retrying…" : "Let the agent retry"}
            </button>
          )}
        </div>
      </div>
      {revocationTx && (
        <p className="muted small">
          Revocation {txUrl ? <a href={txUrl} target="_blank" rel="noreferrer"><code>{truncate(revocationTx)}</code></a> : <code>{truncate(revocationTx)}</code>}
          {" "}· children revoked with the parent
        </p>
      )}
      {retry && (
        <div className="retry-result">
          <p className={`callout ${retry.status === "HALTED_BY_POLICY" ? "callout-deny" : "callout-warn"}`}>
            <i className="ph ph-prohibit" aria-hidden="true" />
            {retry.haltReasonCode ? (
              <>Retry failed: <code>{retry.haltReasonCode}</code> {reasonText(retry.haltReasonCode)}</>
            ) : (
              retry.summary
            )}
          </p>
          <ActivityFeed run={retry} />
        </div>
      )}
    </div>
  );
}
