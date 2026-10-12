import type { AgentRunResult, TraceEntry } from "../api/types";
import { agentLabel, reasonText, resourceLabel, summarizeResult } from "../lib/format";
import { DecisionBadge } from "./DecisionBadge";

/** Renders the LLM-visible trace from POST /agent/runs: what each agent asked for and what ContextCaps returned. */
export function ActivityFeed({ run }: { run: AgentRunResult }) {
  return (
    <ol className="feed">
      {run.trace.map((entry) => (
        <FeedItem key={entry.seq} entry={entry} />
      ))}
    </ol>
  );
}

function Agent({ id }: { id: string }) {
  return <span className={`agent-chip agent-${id}`}>{agentLabel(id)}</span>;
}

function FeedItem({ entry }: { entry: TraceEntry }) {
  if (entry.kind === "task" || entry.kind === "note") {
    return (
      <li className="feed-item feed-note">
        <Agent id={entry.agentId} />
        <span>{entry.text}</span>
      </li>
    );
  }

  if (entry.kind === "external_content") {
    return (
      <li className="feed-item feed-untrusted">
        <Agent id={entry.agentId} />
        <details>
          <summary>
            <i className="ph ph-warning-diamond" aria-hidden="true" /> Read an untrusted page <code>{entry.source}</code>
          </summary>
          <pre>{entry.text}</pre>
        </details>
      </li>
    );
  }

  switch (entry.tool) {
    case "requestContext": {
      const { input, output } = entry;
      const summary = output.allowed ? summarizeResult(input.resource, output.result) : undefined;
      return (
        <li className={`feed-item feed-decision ${output.allowed ? "is-allowed" : "is-denied"}`}>
          <div className="feed-ask">
            <Agent id={entry.agentId} /> requested
            <code className="req">{input.resource}</code>
            <span className="muted">{resourceLabel(input.resource)}</span>
          </div>
          <div className="feed-answer">
            <DecisionBadge decision={output.decision} />
            {summary && <code className="res">{summary}</code>}
            <span className="reason" title={output.reason}>
              <code>{output.reasonCode}</code> {reasonText(output.reasonCode)}
            </span>
          </div>
        </li>
      );
    }
    case "delegateContext": {
      const { input, output } = entry;
      return (
        <li className={`feed-item feed-decision ${output.allowed ? "is-allowed" : "is-denied"}`}>
          <div className="feed-ask">
            <Agent id={entry.agentId} /> delegated to <Agent id={input.childAgentId} />
          </div>
          <div className="feed-answer">
            {output.allowed ? (
              <span className="mode mode-derive"><i className="ph-bold ph-git-fork" aria-hidden="true" />NARROWER CHILD</span>
            ) : (
              <DecisionBadge decision="DENY" />
            )}
            {output.childCapabilityId && <code className="res">{output.childCapabilityId}</code>}
            {output.reasonCode && (
              <span className="reason"><code>{output.reasonCode}</code> {reasonText(output.reasonCode)}</span>
            )}
          </div>
        </li>
      );
    }
    case "searchHotels":
      return (
        <li className="feed-item feed-note">
          <Agent id={entry.agentId} />
          <span>Searched hotels in {entry.input.destination} ({Array.isArray(entry.output) ? entry.output.length : 0} offers)</span>
        </li>
      );
    case "bookHotel": {
      const { output } = entry;
      const bookingStatus = (output.result as { bookingStatus?: string } | undefined)?.bookingStatus;
      return (
        <li className={`feed-item feed-decision ${output.allowed ? "is-allowed" : "is-denied"}`}>
          <div className="feed-ask">
            <Agent id={entry.agentId} /> invoked <code className="req">demo-booking-connector</code>
            <span className="muted">with opaque credential handles</span>
          </div>
          <div className="feed-answer">
            <DecisionBadge decision={output.decision} />
            {bookingStatus && <code className="res">{bookingStatus}</code>}
            <span className="reason"><code>{output.reasonCode}</code> {reasonText(output.reasonCode)}</span>
          </div>
        </li>
      );
    }
  }
}
