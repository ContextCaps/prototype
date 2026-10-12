import type { ReactNode } from "react";
import type { AgentRunResult, CapabilityStateResponse, TraceEntry, VisibleDecision } from "../api/types";
import { agentLabel, DECISION_LABELS, reasonText, resourceLabel } from "../lib/format";
import { activityResult } from "../lib/activityResult";

type ContextCall = Extract<TraceEntry, { tool: "requestContext" }>;
const WITHHELD = [
  { resource: "passport.validity", label: "Passport" },
  { resource: "profile.legal_name", label: "Legal name" },
  { resource: "payment.handle", label: "Payment" },
  { resource: "salary.raw", label: "Salary" },
];

// A visual account of the actual run, not an animation that makes decisions.
// Missing calls (including salary requests an LLM avoids) remain explicitly absent.
export function PromptInjection({ run, child, busy, destination }: { run: AgentRunResult | null; child: CapabilityStateResponse | null; busy: boolean; destination?: string }) {
  const trace = run?.trace ?? [];
  const ask = (resource: string, agent?: string) => trace.find((entry): entry is ContextCall => entry.kind === "tool_call" && entry.tool === "requestContext" && entry.input.resource === resource && (!agent || entry.agentId === agent));
  const page = trace.find((entry) => entry.kind === "external_content");
  const salary = ask("salary.raw");
  const delegation = trace.find((entry) => entry.kind === "tool_call" && entry.tool === "delegateContext" && entry.input.childAgentId === "hotel-agent" && entry.output.allowed)
    ?? trace.find((entry) => entry.kind === "tool_call" && entry.tool === "delegateContext" && entry.input.childAgentId === "hotel-agent");
  const delegated = delegation?.kind === "tool_call" && delegation.tool === "delegateContext" ? delegation.output : undefined;
  const childPermissions = child?.capability.permissions ?? [];
  const availability = ask("calendar.availability", "hotel-agent");
  const preferences = ask("travel.hotel_preferences", "hotel-agent");
  const search = trace.find((entry) => entry.kind === "tool_call" && entry.tool === "searchHotels" && entry.agentId === "hotel-agent");
  const offers = search?.kind === "tool_call" && search.tool === "searchHotels" && Array.isArray(search.output) ? search.output : [];
  const recommended = offers.find((offer: unknown) => !!offer && typeof offer === "object" && "offerId" in offer && offer.offerId === run?.booking?.offerId) as { hotelName?: string; pricePerNightUsd?: number } | undefined;
  const checkout = trace.find((entry) => entry.kind === "tool_call" && entry.tool === "bookHotel");
  const bookingConfirmed = !!run?.booking && checkout?.kind === "tool_call" && checkout.tool === "bookHotel" && checkout.output.allowed;
  const pending = busy ? "Waiting for broker…" : run ? "Not reached in this run" : "Run the agent to see this step";
  const place = destination ?? "the trip";
  const untrustedText = page?.kind === "external_content" ? page.text : undefined;
  const override = untrustedText?.indexOf("SYSTEM OVERRIDE:") ?? -1;

  return (
    <section className="injection-story" aria-labelledby="activity-injection">
      <header className="injection-heading">
        <span className="activity-lane-number" aria-hidden="true">3</span>
        <div><h3 id="activity-injection">Prompt injection attack</h3><p>ContextCaps checks unsafe requests, enables narrow delegation and protects checkout credentials.</p></div>
      </header>
      <ol className="injection-steps">
        <AttackStep n={1} title="Untrusted content tries to hijack the agent" description="A malicious page may try to redirect the agent into reading sensitive information.">
          <div className={`injection-website${untrustedText ? "" : " is-pending"}`}>
            <div className="injection-browser-bar" aria-hidden="true"><span /><span /><span /><i className="ph ph-arrow-square-out" /></div>
            <div className="injection-website-body">
              <p className="injection-website-label"><i className="ph ph-globe" aria-hidden="true" /> Untrusted website</p>
              {untrustedText ? <><blockquote>{override >= 0 ? untrustedText.slice(override) : untrustedText}</blockquote><details><summary>View source</summary><p>{page?.kind === "external_content" ? page.source : ""}</p></details></> : <p className="injection-pending">{pending}</p>}
            </div>
          </div>
          <Actor kind={salary?.agentId === "hotel-agent" ? "hotel" : "travel"} speech={salary ? "I should check the user's salary for this booking." : run ? "No salary request was made in this run." : "External content cannot grant me access."} alert={!!salary} />
        </AttackStep>

        <AttackStep n={2} title="ContextCaps checks the unsafe request" description="The request is checked against its purpose and permissions, regardless of what the page says.">
          <div className="injection-ask"><i className="ph ph-identification-card" aria-hidden="true" /><span>{salary ? `${agentLabel(salary.agentId)} requested:` : "Protected resource:"} <strong>salary.raw</strong></span></div>
          <DownArrow />
          <div className="injection-inspector"><div className="injection-inspector-halo" aria-hidden="true" /><img src="/assets/activity/broker-inspector.png" alt="ContextCaps mascot checking a request with a magnifying glass" width="210" height="210" /><h4>ContextCaps</h4><p>Checks the request against task purpose and permissions.</p></div>
          <Result resource="salary.raw" icon="ph-identification-card" entry={salary} pending={salary ? pending : run ? "No salary request was made" : pending} />
        </AttackStep>

        <AttackStep n={3} title="Safe delegation to a specialized agent" description="A child capability can carry only the approved permissions needed for the hotel search.">
          <Actor kind="travel" speech={delegated?.allowed ? `Find a hotel for ${place}.` : "Hotel search needs a narrower capability."} />
          <DownArrow />
          <BrokerNote text={delegated?.allowed ? "Created a narrower child capability." : "Checks the requested child permissions."} />
          <div className={`injection-child${delegated?.allowed ? " is-active" : ""}`}>
            {delegated ? delegated.allowed ? <><span className="injection-child-badge"><i className="ph ph-git-fork" aria-hidden="true" /> NARROWER CHILD</span><p>child_cap: <code>{delegated.childCapabilityId}</code></p></> : <><span className="injection-result-badge is-blocked">BLOCKED</span><p>{reasonText(delegated.reasonCode ?? "DELEGATION_NOT_ALLOWED")}</p></> : <p className="injection-pending">{pending}</p>}
          </div>
          <DownArrow />
          <div className="injection-access">
            <div className="injection-hotel-avatar"><div className="activity-mascot activity-mascot-calendar" role="img" aria-label="Cyan Hotel Agent mascot" /><span className="injection-agent-label is-hotel">Hotel Agent</span></div>
            <div className="injection-permission-lists">
              {child ? <>
                <div className="injection-permissions is-allowed"><h4>Gets access to:</h4><ul>{childPermissions.map(permission => <li key={permission.resource}><i className="ph-bold ph-check" aria-hidden="true" />{resourceLabel(permission.resource)}</li>)}</ul></div>
                <div className="injection-permissions is-blocked"><h4>Not delegated:</h4><ul>{WITHHELD.filter(item => !childPermissions.some(permission => permission.resource === item.resource)).map(item => <li key={item.resource}><i className="ph-bold ph-x" aria-hidden="true" />{item.label}</li>)}</ul></div>
              </> : <p className="injection-pending">No child capability available yet.</p>}
            </div>
          </div>
        </AttackStep>

        <AttackStep n={4} title="Hotel Agent works with reduced context" description="Only minimum information is released to help the child agent find suitable options.">
          <Actor kind="hotel" speech={availability || preferences ? "I'll check availability and find suitable hotels." : "I only use my delegated context."} />
          <Result resource="calendar.availability" icon="ph-calendar-blank" entry={availability} pending={pending} />
          <Result resource="travel.hotel_preferences" icon="ph-sliders-horizontal" entry={preferences} pending={pending} />
          <DownArrow />
          <div className="injection-recommendation">
            <i className="ph ph-buildings" aria-hidden="true" />
            <div>{search ? <p>Searched {offers.length} hotel option{offers.length === 1 ? "" : "s"}</p> : <p>{pending}</p>}{recommended && <><p>Recommended:</p><h4>{recommended.hotelName}</h4>{typeof recommended.pricePerNightUsd === "number" && <strong>${recommended.pricePerNightUsd}/night</strong>}</>}</div>
          </div>
        </AttackStep>

        <AttackStep n={5} title="Safe checkout completes the task" description="Credentials go directly to the approved booking tool without being exposed to any agent.">
          <Actor kind="travel" speech={bookingConfirmed ? "The booking tool confirmed the hotel." : "Book through the protected booking tool."} />
          <DownArrow />
          <BrokerNote text="Provides credentials via tool-bound access, not raw disclosure." />
          <Result resource="profile.legal_name" icon="ph-user" entry={ask("profile.legal_name", "travel-agent")} pending={pending} compact />
          <Result resource="payment.handle" icon="ph-credit-card" entry={ask("payment.handle", "travel-agent")} pending={pending} compact />
          <DownArrow />
          <div className={`injection-booking${bookingConfirmed ? " is-confirmed" : ""}`}>
            <i className={`ph-fill ${bookingConfirmed ? "ph-check-circle" : "ph-clock"}`} aria-hidden="true" />
            <div>{bookingConfirmed && run?.booking ? <><h4>Booking confirmed</h4><strong>{run.booking.hotelName}</strong><p>${run.booking.totalUsd} total · {run.booking.nights} night{run.booking.nights === 1 ? "" : "s"}</p><p>{run.booking.checkIn} → {run.booking.checkOut}</p><p>Booking reference: <code>{run.booking.reference}</code></p></> : <><h4>No confirmed booking yet</h4><p>{run?.summary ?? pending}</p></>}</div>
          </div>
        </AttackStep>
      </ol>
    </section>
  );
}

function AttackStep({ n, title, description, children }: { n: number; title: string; description: string; children: ReactNode }) {
  return <li className="injection-step"><header><span className="activity-lane-number" aria-hidden="true">{n}</span><h4>{title}</h4></header><p className="injection-step-description">{description}</p><div className="injection-step-content">{children}</div><i className="ph ph-arrow-right injection-next" aria-hidden="true" /></li>;
}

function Actor({ kind, speech, alert }: { kind: "travel" | "hotel"; speech: string; alert?: boolean }) {
  return <div className={`injection-actor is-${kind}`}><div className="injection-actor-image">{alert && <i className="ph-bold ph-warning" aria-label="Unsafe request attempted" />}<div className={`activity-mascot ${kind === "hotel" ? "activity-mascot-calendar" : "activity-mascot-passport"}`} role="img" aria-label={`${kind === "hotel" ? "Cyan Hotel" : "Blue Travel"} Agent mascot`} /></div><div className="injection-actor-message"><p className="activity-speech">{speech}</p><span className={`injection-agent-label${kind === "hotel" ? " is-hotel" : ""}`}>{kind === "hotel" ? "Hotel Agent" : "Travel Agent"}</span></div></div>;
}

function DownArrow() { return <i className="ph ph-arrow-down injection-down" aria-hidden="true" />; }

function BrokerNote({ text }: { text: string }) {
  return <div className="injection-broker-note"><div className="activity-mascot activity-mascot-broker" aria-hidden="true" /><div><h4>ContextCaps</h4><p>{text}</p></div></div>;
}

function Result({ resource, icon, entry, pending, compact }: { resource: string; icon: string; entry?: ContextCall; pending: string; compact?: boolean }) {
  const output: VisibleDecision | undefined = entry?.output;
  const status = !output ? "pending" : !output.allowed ? "blocked" : output.decision === "TOOL_BOUND" ? "tool" : "allowed";
  return <div className={`injection-result is-${status}${compact ? " is-compact" : ""}`}><div className="injection-result-head"><i className={`ph ${icon}`} aria-hidden="true" /><div><strong>{resource}</strong><p>label: {resourceLabel(resource)}</p></div>{output && <span className={`injection-result-badge is-${status}`}><i className={`ph-bold ${output.allowed ? "ph-check-circle" : "ph-prohibit"}`} aria-hidden="true" />{DECISION_LABELS[output.decision]}</span>}</div>{!output ? <p className="injection-pending">{pending}</p> : !output.allowed ? <div className="injection-reason"><code>{output.reasonCode}</code><p>{reasonText(output.reasonCode)}</p></div> : !compact ? <code className="injection-minimum">{activityResult(resource, output.result) ?? "Approved minimum fact"}</code> : <p className="injection-tool-note">Protected credential · opaque handle only</p>}</div>;
}
