import { ActivityFeed } from "./components/ActivityFeed";
import { AuditLog } from "./components/AuditLog";
import { AuthorizeStep } from "./components/AuthorizeStep";
import { CheckoutCard } from "./components/CheckoutCard";
import { DelegationView } from "./components/DelegationView";
import { Header } from "./components/Header";
import { RevokePanel } from "./components/RevokePanel";
import { Step } from "./components/Step";
import { useDemo } from "./lib/useDemo";

export function App() {
  const { state, authorize, runAgent, revoke, retryAfterRevoke, reset, checkHealth } = useDemo();
  const { health, auth, run, root, child, audit, busy, error } = state;
  const provider = health?.provider;

  return (
    <>
      <Header health={health} healthError={state.healthError} resetting={busy === "reset"} onReset={reset} onRecheck={checkHealth} />

      <main className="container console">
        <div className="intro">
          <h1>
            Give agents the <span className="accent">answer</span>,<br />not the data.
          </h1>
          <p>Authorize a task, watch the agent ask for more than it needs, and see ContextCaps hand back only the minimum.</p>
        </div>

        {error && (
          <p className="callout callout-deny" role="alert">
            <i className="ph ph-warning-circle" aria-hidden="true" /> {error}
          </p>
        )}

        <Step n={1} title="Authorize the task" lead="One purpose-bound capability for the Travel Agent. Raw data is never part of it.">
          <AuthorizeStep health={health} auth={auth} busy={busy === "authorize"} onAuthorize={authorize} />
        </Step>

        <Step
          n={2}
          title="Agent activity"
          lead="Every request goes through the broker. Raw asks are blocked; minimum facts are derived."
          locked={!auth && "Authorize the task to let the Travel Agent start."}
          aside={
            auth && !run && (
              <button type="button" className="btn btn-primary" onClick={runAgent} disabled={!!busy}>
                {busy === "run" ? "Agent working…" : "Run Travel Agent"} <i className="ph ph-play" aria-hidden="true" />
              </button>
            )
          }
        >
          {run ? <ActivityFeed run={run} /> : <p className="muted">The agent has not run yet.</p>}
        </Step>

        <Step
          n={3}
          title="Delegate & check out"
          lead="The Hotel Agent gets a narrower capability. Checkout secrets go only to the booking tool."
          locked={!run && "Runs after the Travel Agent finishes."}
        >
          <div className="grid-2">
            {root && <DelegationView root={root} child={child} audit={audit} />}
            {run && <CheckoutCard run={run} />}
          </div>
        </Step>

        <Step n={4} title="Revoke access" lead="Revocation cascades to every child capability and fails closed." locked={!run && "Available after the agent has run."}>
          {root && (
            <RevokePanel
              provider={provider}
              root={root}
              child={child}
              retry={state.retry}
              busy={busy === "revoke" || busy === "retry" ? busy : null}
              onRevoke={revoke}
              onRetry={retryAfterRevoke}
            />
          )}
        </Step>

        <Step n={5} title="Audit & proof" lead="Receipts hold hashes and commitments only, never private values." locked={!audit && "Receipts appear once the task is authorized."}>
          {audit && <AuditLog audit={audit} provider={provider} />}
        </Step>
      </main>

      <footer className="container site-footer">
        <span>ContextCaps · Monad Metropolis</span>
        <span className="muted">{health ? `Broker: ${health.provider}` : "Broker offline"}</span>
      </footer>
    </>
  );
}
