import type { DisclosureMode } from "../api/types";
import { DECISION_LABELS } from "../lib/format";

const ICONS: Record<DisclosureMode, string> = {
  DENY: "ph-prohibit",
  DERIVE: "ph-function",
  SELECT: "ph-funnel-simple",
  TOOL_BOUND: "ph-lock-key",
};

export function DecisionBadge({ decision }: { decision: DisclosureMode }) {
  return (
    <span className={`mode mode-${decision.toLowerCase().replace("_", "-")}`}>
      <i className={`ph-bold ${ICONS[decision]}`} aria-hidden="true" />
      {DECISION_LABELS[decision]}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return <span className={`status status-${status.toLowerCase().replace(/_/g, "-")}`}>{status}</span>;
}
