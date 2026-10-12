import type { AgentRunResult, CapabilityStateResponse, TraceEntry } from "../api/types";
import { agentLabel, explorerTxUrl, reasonText, resourceLabel, truncate } from "../lib/format";
import { StatusBadge } from "./DecisionBadge";

interface Props {
  provider: string | undefined;
  root: CapabilityStateResponse;
  child: CapabilityStateResponse | null;
  retry: AgentRunResult | null;
  busy: "revoke" | "retry" | null;
  progress: string | null;
  onRevoke: () => void;
  onRetry: () => void;
}

type ContextCall = Extract<TraceEntry, { tool: "requestContext" }>;

export function RevokePanel({ provider, root, child, retry, busy, progress, onRevoke, onRetry }: Props) {
  const revoked = root.capability.status === "REVOKED";
  const txHash = root.chain.revocationTxHash;
  const txUrl = explorerTxUrl(provider, txHash);
  const retryRequest = retry?.trace.find((entry): entry is ContextCall => entry.kind === "tool_call" && entry.tool === "requestContext");
  const retryReason = retryRequest?.output.reasonCode ?? retry?.haltReasonCode;
  const blocked = retryRequest ? !retryRequest.output.allowed : retry?.status === "HALTED_BY_POLICY";

  if (!revoked) {
    return (
      <div className="tile stage4-before">
        <div className="stage4-before-copy"><i className="ph ph-shield-check" aria-hidden="true" /><div><h3>Access is active</h3><p>Withdraw the Travel Agent capability to stop its delegated child as well.</p></div></div>
        <ul className="stage4-before-list">
          {[root, child].filter((state): state is CapabilityStateResponse => !!state).map((state) => <li key={state.capability.capabilityId}><strong>{agentLabel(state.capability.agentId)}</strong><code>{state.capability.capabilityId}</code><StatusBadge status={state.capability.status} /></li>)}
        </ul>
        <div className="revoke-actions">
          {busy === "revoke" && progress && <span className="progress">{progress}</span>}
          <button type="button" className="btn btn-danger" onClick={onRevoke} disabled={!!busy}><i className="ph ph-hand-palm" aria-hidden="true" />{busy === "revoke" ? "Revoking…" : "Revoke Access"}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="stage4-after">
      <section className="tile stage4-revoked" aria-labelledby="stage4-revoked-title">
        <div className="stage4-revoked-top">
          <div className="stage4-revoked-heading"><span className="stage4-revoked-icon"><i className="ph ph-prohibit" aria-hidden="true" /></span><h3 id="stage4-revoked-title">Access revoked</h3></div>
          <button type="button" className="btn stage4-retry-button" onClick={onRetry} disabled={!!busy}><i className="ph ph-arrow-clockwise" aria-hidden="true" />{busy === "retry" ? "Retrying…" : "Let the agent retry"}</button>
        </div>
        <div className="stage4-cap-tree">
          <CapabilityRow state={root} />
          {child && <><i className="ph ph-arrow-down stage4-tree-arrow" aria-hidden="true" /><CapabilityRow state={child} inherited={child.capability.status === "REVOKED" && child.capability.parentCapabilityId === root.capability.capabilityId} /></>}
        </div>
        {txHash && <p className="stage4-tx"><i className="ph ph-link" aria-hidden="true" />tx {txUrl ? <a href={txUrl} target="_blank" rel="noreferrer"><code>{truncate(txHash)}</code></a> : <code>{truncate(txHash)}</code>}</p>}
      </section>

      {retry && <section className="tile stage4-attempt" aria-label="Agent retry result">
        {retryRequest ? <p className="stage4-request"><span>{agentLabel(retryRequest.agentId)}</span> requested <code>{retryRequest.input.resource}</code> {resourceLabel(retryRequest.input.resource)}</p> : <p className="stage4-request">Agent retry result</p>}
        <div className={`stage4-verdict${blocked ? " is-blocked" : " is-allowed"}`}>
          <i className={`ph ${blocked ? "ph-prohibit" : "ph-check-circle"}`} aria-hidden="true" />
          <span className="stage4-verdict-badge">{blocked ? "BLOCKED" : "ALLOWED"}</span>
          <div><strong>{retryReason ? `${reasonText(retryReason)}.` : retry.summary}</strong>{retryReason && <code>{retryReason}</code>}</div>
        </div>
      </section>}
    </div>
  );
}

function CapabilityRow({ state, inherited = false }: { state: CapabilityStateResponse; inherited?: boolean }) {
  return <div className="stage4-cap-row"><strong>{agentLabel(state.capability.agentId)}</strong><code>{state.capability.capabilityId}</code><StatusBadge status={state.capability.status} />{inherited && <span className="stage4-inherited">· inherited</span>}</div>;
}
