import type { AuditResponse, CapabilityStateResponse, ContextPermission } from "../api/types";
import { agentLabel, reasonText, resourceLabel } from "../lib/format";
import { StatusBadge } from "./DecisionBadge";

interface Props {
  root: CapabilityStateResponse;
  child: CapabilityStateResponse | null;
  audit: AuditResponse | null;
}

const modes = (p: ContextPermission) => p.allowedModes.join(" · ");

/** Parent → child capability, with everything the child did NOT inherit shown as withheld. */
export function DelegationView({ root, child, audit }: Props) {
  const childResources = new Set(child?.capability.permissions.map((p) => p.resource));
  const rejected = audit?.lifecycle.filter((e) => e.type === "DELEGATION_REJECTED") ?? [];

  return (
    <div className="tile">
      <span className="eyebrow"><i className="ph ph-git-fork" aria-hidden="true" /> Delegation</span>
      <div className="deleg">
        <CapNode state={root} />
        <i className="ph ph-arrow-down deleg-arrow" aria-hidden="true" />
        {child ? (
          <div className="deleg-node">
            <div className="deleg-head">
              <strong>{agentLabel(child.capability.agentId)}</strong>
              <code>{child.capability.capabilityId}</code>
              <StatusBadge status={child.capability.status} />
            </div>
            <ul className="fields">
              {root.capability.permissions.map((p) =>
                childResources.has(p.resource) ? (
                  <li key={p.resource}>
                    <i className="ph-bold ph-check" aria-hidden="true" />
                    {resourceLabel(p.resource)}
                    <span className="perm-modes">{modes(child.capability.permissions.find((c) => c.resource === p.resource)!)}</span>
                  </li>
                ) : (
                  <li key={p.resource} className="withheld">
                    <i className="ph-bold ph-x" aria-hidden="true" />
                    {resourceLabel(p.resource)}
                  </li>
                ),
              )}
            </ul>
            <p className="muted small">Depth {child.capability.delegationDepth} · cannot re-delegate · revoked with its parent</p>
          </div>
        ) : (
          <p className="muted">No child capability yet.</p>
        )}
      </div>
      {rejected.map((e) => (
        <p key={e.eventId} className="callout callout-deny">
          <i className="ph ph-prohibit" aria-hidden="true" />
          Rejected delegation to {agentLabel(e.agentId ?? "")}: <code>{e.reasonCode}</code> {reasonText(e.reasonCode ?? "")}
        </p>
      ))}
    </div>
  );
}

function CapNode({ state }: { state: CapabilityStateResponse }) {
  const { capability } = state;
  return (
    <div className="deleg-node is-root">
      <div className="deleg-head">
        <strong>{agentLabel(capability.agentId)}</strong>
        <code>{capability.capabilityId}</code>
        <StatusBadge status={capability.status} />
      </div>
      <ul className="fields">
        {capability.permissions.map((p) => (
          <li key={p.resource}>
            <i className="ph-bold ph-check" aria-hidden="true" />
            {resourceLabel(p.resource)}
            <span className="perm-modes">{modes(p)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
