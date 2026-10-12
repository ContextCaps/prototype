import type { AuditResponse, CapabilityStateResponse, ContextPermission } from "../api/types";
import { agentLabel, reasonText, resourceLabel } from "../lib/format";
import { StatusBadge } from "./DecisionBadge";

interface Props {
  root: CapabilityStateResponse;
  child: CapabilityStateResponse | null;
  audit: AuditResponse | null;
}

const ICONS: Record<string, string> = {
  "passport.validity": "ph-identification-card",
  "calendar.availability": "ph-calendar-blank",
  "travel.hotel_preferences": "ph-buildings",
  "profile.legal_name": "ph-user",
  "payment.handle": "ph-credit-card",
};

export function DelegationView({ root, child, audit }: Props) {
  const childResources = new Set(child?.capability.permissions.map((permission) => permission.resource));
  const withheld = child ? root.capability.permissions.filter((permission) => !childResources.has(permission.resource)) : [];
  const rejected = audit?.lifecycle.filter((event) => event.type === "DELEGATION_REJECTED") ?? [];

  return (
    <section className="tile stage3-delegation" aria-labelledby="stage3-delegation-title">
      <header className="stage3-panel-heading">
        <i className="ph ph-git-fork" aria-hidden="true" />
        <div><h3 id="stage3-delegation-title">Safe delegation</h3><p>ContextCaps gives the Hotel Agent only the permissions needed for this task.</p></div>
      </header>

      <div className="stage3-delegation-flow">
        <CapabilityCard state={root} kind="travel" />
        <div className="stage3-scope" aria-label="ContextCaps narrows the scope">
          <div className="stage3-scope-face"><span className="activity-mascot activity-mascot-broker" aria-hidden="true" /></div>
          <strong>ContextCaps</strong><p>narrows the scope</p>
          <i className="ph ph-arrow-right" aria-hidden="true" />
        </div>
        {child ? (
          <CapabilityCard state={child} kind="hotel" withheld={withheld} />
        ) : (
          <div className="stage3-cap-card stage3-awaiting"><i className="ph ph-clock" aria-hidden="true" /><p>No child capability yet.</p></div>
        )}
      </div>

      {rejected.map((event) => (
        <p key={event.eventId} className="callout callout-deny">
          <i className="ph ph-prohibit" aria-hidden="true" />
          Rejected delegation to {agentLabel(event.agentId ?? "")}: <code>{event.reasonCode}</code> {reasonText(event.reasonCode ?? "")}
        </p>
      ))}
    </section>
  );
}

function CapabilityCard({ state, kind, withheld = [] }: { state: CapabilityStateResponse; kind: "travel" | "hotel"; withheld?: ContextPermission[] }) {
  const capability = state.capability;
  const cannotRedelegate = capability.delegationDepth >= capability.maxDelegationDepth || !capability.permissions.some((permission) => permission.delegable);

  return (
    <div className={`stage3-cap-card is-${kind}`}>
      <div className="stage3-cap-identity">
        <div className={`stage3-cap-avatar is-${kind}`}><div className={`activity-mascot ${kind === "travel" ? "activity-mascot-passport" : "activity-mascot-calendar"}`} role="img" aria-label={`${kind === "travel" ? "Blue Travel" : "Cyan Hotel"} Agent mascot`} /></div>
        <div><h4>{agentLabel(capability.agentId)}</h4><code>{capability.capabilityId}</code><StatusBadge status={capability.status} /></div>
      </div>
      <ul className="stage3-permissions" aria-label={`${agentLabel(capability.agentId)} permissions`}>
        {capability.permissions.map((permission) => (
          <li key={permission.resource}>
            <i className={`ph ${ICONS[permission.resource] ?? "ph-shield-check"}`} aria-hidden="true" />
            <span>{resourceLabel(permission.resource)}</span>
            <code>{permission.allowedModes.join(" · ")}</code>
          </li>
        ))}
      </ul>
      {withheld.length > 0 && <div className="stage3-withheld"><p>Not delegated</p><ul>{withheld.map((permission) => <li key={permission.resource}><i className={`ph ${ICONS[permission.resource] ?? "ph-shield"}`} aria-hidden="true" /><span>{resourceLabel(permission.resource)}</span><i className="ph-bold ph-x" aria-hidden="true" /></li>)}</ul></div>}
      {kind === "hotel" && <p className="stage3-cap-foot">Depth {capability.delegationDepth} · {cannotRedelegate ? "cannot re-delegate" : "delegation limited by policy"} · revoked with its parent</p>}
    </div>
  );
}
