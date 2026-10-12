import type { AgentRunResult, TraceEntry } from "../api/types";
import { truncate } from "../lib/format";

type ContextCall = Extract<TraceEntry, { tool: "requestContext" }>;

/** Tool-bound checkout: the agent held only opaque handles; the connector received the secrets. */
export function CheckoutCard({ run }: { run: AgentRunResult }) {
  const handles = run.trace
    .filter((e): e is ContextCall => e.kind === "tool_call" && e.tool === "requestContext" && e.output.decision === "TOOL_BOUND")
    .map((e) => ({ resource: e.input.resource, handle: (e.output.result as { handle?: string } | undefined)?.handle }));
  const booking = run.booking;

  return (
    <div className="tile tile-tool">
      <span className="eyebrow"><i className="ph ph-lock-key" aria-hidden="true" /> Tool-bound checkout</span>
      {booking ? (
        <>
          <div className="booking">
            <div>
              <h3>{booking.hotelName}</h3>
              <p className="muted">{booking.checkIn} → {booking.checkOut} · {booking.nights} night{booking.nights === 1 ? "" : "s"}</p>
            </div>
            <div className="booking-total">
              <strong>${booking.totalUsd}</strong>
              <span className="status status-active">CONFIRMED</span>
            </div>
          </div>
          <p className="muted small">Reference <code>{booking.reference}</code></p>
        </>
      ) : (
        <p className="muted">{run.summary}</p>
      )}
      <ul className="handles">
        {handles.map((h) => (
          <li key={h.resource}>
            <i className="ph-fill ph-shield-check" aria-hidden="true" />
            <div>
              <b>{h.resource === "payment.handle" ? "Booking credential" : "Traveller identity"}</b>
              <span>Protected by ContextCaps</span>
            </div>
            {h.handle && <code title="Opaque handle — useless outside the booking connector">{truncate(h.handle)}</code>}
          </li>
        ))}
      </ul>
    </div>
  );
}
