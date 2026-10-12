import type { AgentRunResult, TraceEntry } from "../api/types";
import { truncate } from "../lib/format";

type ContextCall = Extract<TraceEntry, { tool: "requestContext" }>;
const BOOKING_CONNECTOR = "demo-booking-connector";

/** The agent sees handles; the approved connector receives the underlying credentials. */
export function CheckoutCard({ run }: { run: AgentRunResult }) {
  const contextCalls = run.trace.filter((entry): entry is ContextCall => entry.kind === "tool_call" && entry.tool === "requestContext" && entry.output.decision === "TOOL_BOUND" && entry.output.allowed);
  const handles = ["profile.legal_name", "payment.handle"].flatMap((resource) => {
    const call = contextCalls.find((entry) => entry.input.resource === resource);
    const result = call?.output.result;
    const handle = result && typeof result === "object" && "handle" in result && typeof result.handle === "string" ? result.handle : undefined;
    return call ? [{ resource, handle }] : [];
  });
  const booking = run.booking;
  const confirmed = !!booking && run.trace.some((entry) => entry.kind === "tool_call" && entry.tool === "bookHotel" && entry.output.allowed);

  return (
    <section className="tile stage3-checkout" aria-labelledby="stage3-checkout-title">
      <header className="stage3-panel-heading">
        <i className="ph ph-lock-key" aria-hidden="true" />
        <div><h3 id="stage3-checkout-title">Tool-bound checkout</h3><p>Sensitive credentials are used through the approved booking tool without exposing them to an agent.</p></div>
      </header>

      {booking ? (
        <div className="stage3-booking">
          <div className="stage3-hotel-image" aria-hidden="true"><i className="ph ph-buildings" /></div>
          <div className="stage3-booking-main"><h4>{booking.hotelName}</h4><p>{dateLabel(booking.checkIn)} – {dateLabel(booking.checkOut)} · {booking.nights} night{booking.nights === 1 ? "" : "s"}</p><div className="stage3-booking-reference"><span>Reference: <code>{booking.reference}</code></span>{confirmed && <span className="stage3-confirmed"><i className="ph-fill ph-check-circle" aria-hidden="true" />CONFIRMED</span>}</div></div>
          <div className="stage3-booking-price"><strong>${booking.totalUsd}</strong><span>total</span></div>
        </div>
      ) : <p className="stage3-no-booking">{run.summary}</p>}

      <i className="ph ph-arrow-down stage3-checkout-arrow" aria-hidden="true" />
      <div className="stage3-credential-box">
        <div className="stage3-credential-heading"><div className="stage3-credential-icon"><i className="ph ph-handshake" aria-hidden="true" /></div><div><h4>Credentials go only to the booking tool</h4><p>ContextCaps supplies them directly to the approved connector.</p></div></div>
        <div className="stage3-credential-path">
          <ul className="stage3-handles">
            {handles.map(({ resource, handle }) => (
              <li key={resource}>
                <i className={`ph ${resource === "payment.handle" ? "ph-credit-card" : "ph-user"}`} aria-hidden="true" />
                <div><strong>{resource === "payment.handle" ? "Booking credential" : "Traveller identity"}</strong><span>{resource === "payment.handle" ? "Payment method" : "Legal name for booking"}</span></div>
                <div className="stage3-handle-status"><span><i className="ph ph-link" aria-hidden="true" />TOOL_BOUND</span>{handle && <code title="Opaque handle; the secret is not displayed">{truncate(handle)}</code>}</div>
              </li>
            ))}
            {handles.length === 0 && <li className="stage3-handle-empty">No tool-bound credential was issued in this run.</li>}
          </ul>
          <i className="ph ph-arrow-right stage3-tool-arrow" aria-hidden="true" />
          <div className="stage3-booking-tool"><i className="ph ph-buildings" aria-hidden="true" /><strong>Booking tool</strong><code>{BOOKING_CONNECTOR}</code></div>
        </div>
        <p className="stage3-security-note"><i className="ph-fill ph-info" aria-hidden="true" />The agent sees only opaque handles. The booking tool receives the underlying credentials.</p>
      </div>
    </section>
  );
}

function dateLabel(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? date : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(parsed);
}
