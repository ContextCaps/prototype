import type { AgentRunResult, CapabilityStateResponse, TraceEntry, VisibleDecision } from "../api/types";
import { DECISION_LABELS, reasonText, resourceLabel } from "../lib/format";
import { activityResult } from "../lib/activityResult";
import { ActivityFeed } from "./ActivityFeed";
import { PromptInjection } from "./PromptInjection";

// Stage 2 inherits the lavender console and the user's reference composition:
// blue Travel Agents → raw requests → purple ContextCaps → minimal answers.
// Every decision and result below comes from the broker's travel-agent trace.
type ContextEntry = Extract<TraceEntry, { kind: "tool_call"; tool: "requestContext" }>;

const REQUESTS = [
  { id: "passport", title: "Passport request", raw: "passport.raw", derived: "passport.validity", icon: "ph-identification-card", speech: "I need the passport for this trip.", lead: "The agent wants your full passport, but ContextCaps only releases what's needed.", protected: "Raw passport stays private.", sprite: "passport" },
  { id: "calendar", title: "Calendar request", raw: "calendar.raw", derived: "calendar.availability", icon: "ph-calendar-blank", speech: "Show me your full calendar.", lead: "The agent asks for your full calendar, but only gets availability, no titles or details.", protected: "Meeting titles and full calendar contents are not exposed.", sprite: "calendar" },
] as const;

function contextEntry(run: AgentRunResult | null, resource: string): ContextEntry | undefined {
  return run?.trace.find((entry): entry is ContextEntry => entry.kind === "tool_call" && entry.tool === "requestContext" && entry.agentId === "travel-agent" && entry.input.resource === resource);
}

export function AgentActivity({ run, busy, child, destination }: { run: AgentRunResult | null; busy: boolean; child: CapabilityStateResponse | null; destination?: string }) {
  return (
    <div className="activity-story">
      <p className="sr-only" role="status">{busy ? "The agent is working. Waiting for broker decisions." : run ? `Agent run finished: ${run.status}.` : "Ready to run. No context requests have been made yet."}</p>
      <div className="activity-flow">
        {REQUESTS.map((request, index) => {
          const raw = contextEntry(run, request.raw);
          const derived = contextEntry(run, request.derived);
          return (
            <section className="activity-lane" aria-labelledby={`activity-${request.id}`} key={request.id}>
              <header className="activity-lane-head">
                <span className="activity-lane-number" aria-hidden="true">{index + 1}</span>
                <h3 id={`activity-${request.id}`}>{request.title}</h3>
                <p>{request.lead}</p>
              </header>
              <div className="activity-lane-content">
                <div className="activity-agent-scene">
                  <div className={`activity-mascot activity-mascot-${request.sprite}`} role="img" aria-label="Blue Travel Agent mascot" />
                  <div className="activity-agent-message">
                    <p className="activity-speech">{raw ? request.speech : run ? "I only need the minimum facts for this trip." : "Ready to check what's needed for this trip."}</p>
                    <span className="activity-agent-label">Travel Agent</span>
                  </div>
                </div>
                <RequestCard resource={request.raw} icon={request.icon} entry={raw} complete={!!run} busy={busy} protectedText={request.protected} />
                <div className="activity-passage" aria-hidden="true">
                  <svg viewBox="0 0 180 140" preserveAspectRatio="none">
                    <path d={index === 0 ? "M0 30 C48 30 30 100 76 100 M106 100 C150 100 134 30 180 30" : "M0 110 C48 110 30 40 76 40 M106 40 C150 40 134 110 180 110"} />
                    <path className="activity-arrow" d={index === 0 ? "M67 92 L77 100 L67 108 M169 22 L179 30 L169 38" : "M67 32 L77 40 L67 48 M169 102 L179 110 L169 118"} />
                  </svg>
                </div>
                <RequestCard resource={request.derived} icon={request.icon} entry={derived} complete={!!run} busy={busy} />
              </div>
            </section>
          );
        })}
        <div className="activity-broker">
          <div className="activity-broker-orbit" aria-hidden="true" />
          <div className="activity-mascot activity-mascot-broker" role="img" aria-label="Purple ContextCaps mascot" />
          <div className="activity-broker-caption">
            <h3><i className="ph-fill ph-shield-check" aria-hidden="true" /> ContextCaps</h3>
            <p>Checks, filters and releases only the minimum facts.</p>
          </div>
        </div>
      </div>
      <PromptInjection run={run} child={child} busy={busy} destination={destination} />
      {run && (
        <details className="activity-trace">
          <summary><span><i className="ph ph-list-bullets" aria-hidden="true" /> View full agent activity</span><span>{run.trace.length} events <i className="ph ph-caret-down" aria-hidden="true" /></span></summary>
          <p>Review the complete activity trace returned by the broker.</p>
          <ActivityFeed run={run} />
        </details>
      )}
    </div>
  );
}

function RequestCard({ resource, icon, entry, complete, busy, protectedText }: { resource: string; icon: string; entry?: ContextEntry; complete: boolean; busy: boolean; protectedText?: string }) {
  const output = entry?.output;
  const state = !output ? "pending" : output.allowed ? "allowed" : "blocked";
  const result = output?.allowed ? activityResult(resource, output.result) : undefined;
  const pending = busy ? "Waiting for broker…" : complete ? "Not requested in this run" : "Awaiting request";
  return (
    <article className={`activity-request is-${state}`} aria-label={`${resourceLabel(resource)}: ${output ? DECISION_LABELS[output.decision] : pending}`}>
      <div className="activity-request-head">
        <span className="activity-resource-icon"><i className={`ph ${icon}`} aria-hidden="true" /></span>
        <div className="activity-resource-name"><p><span>{output ? "requested:" : "resource:"}</span> <strong>{resource}</strong></p><p>label: {resourceLabel(resource)}</p></div>
        {output && <ActivityDecision output={output} />}
      </div>
      <div className="activity-request-result">
        {output ? output.allowed ? <code>{result ?? "Approved minimum disclosure"}</code> : <><code>{output.reasonCode}</code><p>{output.reasonCode === "RAW_DISCLOSURE_FORBIDDEN" ? protectedText : reasonText(output.reasonCode)}</p></> : <p>{pending}</p>}
      </div>
      {output?.allowed && <p className="activity-release-note">{reasonText(output.reasonCode)}.</p>}
    </article>
  );
}

function ActivityDecision({ output }: { output: VisibleDecision }) {
  return <span className={`activity-decision ${output.allowed ? "is-allowed" : "is-blocked"}`}><i className={`ph-bold ${output.allowed ? "ph-check" : "ph-prohibit"}`} aria-hidden="true" />{DECISION_LABELS[output.decision]}</span>;
}
