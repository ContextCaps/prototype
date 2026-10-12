import { useMemo, useState, type FormEvent } from "react";
import type { CreateMandateRequest, HealthResponse } from "../api/types";
import type { Authorization } from "../lib/useDemo";
import { explorerTxUrl, truncate } from "../lib/format";
import { conflictSignature, detectConflicts, money, parseTask } from "../lib/parseTask";
import { hasWallet } from "../lib/wallet";
import { StatusBadge } from "./DecisionBadge";

const PRINCIPAL = import.meta.env.VITE_PRINCIPAL || "0xA11CE";
const GOLDEN_TASK = "Book my Singapore trip next weekend under $700.";

/** What the travel-booking template grants vs. withholds (docs/PERSON_3_PRODUCT.md P3-02). */
const ALLOWED = [
  { icon: "ph-identification-card", label: "Passport eligibility" },
  { icon: "ph-calendar-check", label: "Available travel window" },
  { icon: "ph-bed", label: "Hotel preferences" },
  { icon: "ph-credit-card", label: "Booking credentials at checkout" },
];
const WITHHELD = ["Raw passport", "Full calendar", "Salary", "Raw payment credentials"];

const parseBudget = (text: string): number | null => {
  const value = Number(text.replace(/[,$\s]/g, ""));
  return Number.isFinite(value) && value > 0 ? value : null;
};

interface Props {
  health: HealthResponse | null;
  auth: Authorization | null;
  busy: boolean;
  /** Wallet signing: the connected account is the principal and signs on Monad. */
  walletMode: boolean;
  account: string | null;
  connecting: boolean;
  progress: string | null;
  onConnect: () => void;
  onAuthorize: (req: CreateMandateRequest) => void;
}

/**
 * Stage 1. The task sentence stays editable, while Destination and Budget are
 * the structured values the broker actually receives. When the sentence and
 * those values disagree the UI refuses to pick for the user: it shows both
 * sides and blocks authorization until one is chosen. Once the capability
 * exists every input is locked, because changing it means a new authorization.
 */
export function AuthorizeStep({ health, auth, busy, walletMode, account, connecting, progress, onConnect, onAuthorize }: Props) {
  const [description, setDescription] = useState(GOLDEN_TASK);
  const [destination, setDestination] = useState("Singapore");
  const [budgetText, setBudgetText] = useState("700");
  /** Signature of the disagreement the user chose to keep, so it stays resolved. */
  const [acknowledged, setAcknowledged] = useState("");

  const locked = !!auth;
  const budgetUsd = parseBudget(budgetText);
  const parsed = useMemo(() => parseTask(description), [description]);
  const conflicts = useMemo(
    () => detectConflicts(parsed, { destination, budgetUsd }),
    [parsed, destination, budgetUsd],
  );
  const signature = conflictSignature(conflicts);
  const unresolved = !locked && signature !== "" && signature !== acknowledged;
  const conflicted = (field: "destination" | "budget") => unresolved && conflicts.some((c) => c.field === field);

  const onMonad = health?.provider === "monad";
  const principal = walletMode ? account : PRINCIPAL;
  const principalMismatch = onMonad && !walletMode && !/^0x[0-9a-fA-F]{40}$/.test(PRINCIPAL);
  const needsWallet = walletMode && !account;
  const incomplete = !destination.trim() || budgetUsd === null;

  const useTaskValues = () => {
    if (parsed.destination) setDestination(parsed.destination);
    if (parsed.budgetUsd !== undefined) setBudgetText(String(parsed.budgetUsd));
    setAcknowledged("");
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!principal || unresolved || incomplete || budgetUsd === null) return;
    onAuthorize({ principal, description, constraints: { destination: destination.trim(), budgetUsd } });
  };

  const sourceNote = (field: "destination" | "budget") => {
    const stated = field === "destination" ? parsed.destination !== undefined : parsed.budgetUsd !== undefined;
    if (!stated) return { text: "Not stated in your task", differs: false };
    const differs = conflicts.some((c) => c.field === field);
    return { text: differs ? "Differs from your task" : "Parsed from your task", differs };
  };

  const txUrl = explorerTxUrl(health?.provider, auth?.chain.txHash);

  /** Once authorized, the card shows the mandate the broker recorded, not local edits. */
  const authorized = auth && {
    description: auth.mandate.description,
    destination: auth.mandate.constraints.destination ?? destination,
    budgetUsd: auth.mandate.constraints.budgetUsd ?? null,
  };

  return (
    <div className="authorize">
      <div className="authorize-aside">
        <p className="aside-bubble">You're giving a specific capability for a specific purpose, not your raw data.</p>
        <img src="/assets/how/other-mascot.webp" alt="" width="290" height="340" loading="lazy" />
      </div>

      <form className="tile task-card" onSubmit={submit}>
        <span className="eyebrow"><i className="ph ph-chat-text" aria-hidden="true" /> Task</span>

        {authorized ? (
          <p className="task-text">{authorized.description}</p>
        ) : (
          <>
            <label className="sr-only" htmlFor="auth-task">What should the agent do?</label>
            <textarea
              id="auth-task"
              className="task-input"
              rows={2}
              value={description}
              placeholder="Describe the task in your own words."
              onChange={(e) => setDescription(e.target.value)}
            />
          </>
        )}

        <div className="facts">
          <div className="fact">
            <span className="fact-icon"><i className="ph ph-paper-plane-tilt" aria-hidden="true" /></span>
            <div className="fact-body">
              <span className="fact-label">Agent</span>
              <span className="fact-value">Travel Agent</span>
              {!locked && <span className="fact-note">Fixed for this task</span>}
            </div>
          </div>

          <div className={`fact${conflicted("destination") ? " is-conflicted" : ""}`}>
            <span className="fact-icon"><i className="ph ph-map-pin" aria-hidden="true" /></span>
            <div className="fact-body">
              <label className="fact-label" htmlFor="auth-destination">Destination</label>
              {authorized ? (
                <span className="fact-value">{authorized.destination}</span>
              ) : (
                <>
                  <input
                    id="auth-destination"
                    className="fact-input"
                    value={destination}
                    autoComplete="off"
                    onChange={(e) => setDestination(e.target.value)}
                  />
                  <span className={`fact-note${sourceNote("destination").differs ? " is-differs" : ""}`}>
                    {sourceNote("destination").text}
                  </span>
                </>
              )}
            </div>
          </div>

          <div className={`fact${conflicted("budget") ? " is-conflicted" : ""}`}>
            <span className="fact-icon is-money"><i className="ph ph-currency-dollar" aria-hidden="true" /></span>
            <div className="fact-body">
              <label className="fact-label" htmlFor="auth-budget">Budget</label>
              {authorized ? (
                <span className="fact-value">{authorized.budgetUsd === null ? "Not set" : money(authorized.budgetUsd)}</span>
              ) : (
                <>
                  <span className="fact-input-row">
                    <span aria-hidden="true">$</span>
                    <input
                      id="auth-budget"
                      className="fact-input"
                      inputMode="decimal"
                      value={budgetText}
                      autoComplete="off"
                      onChange={(e) => setBudgetText(e.target.value)}
                    />
                  </span>
                  <span className={`fact-note${sourceNote("budget").differs ? " is-differs" : ""}`}>
                    {sourceNote("budget").text}
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="fact">
            <span className="fact-icon"><i className="ph ph-file-text" aria-hidden="true" /></span>
            <div className="fact-body">
              <span className="fact-label">Purpose</span>
              <span className="fact-value"><code>travel-booking</code></span>
              {!locked && <span className="fact-note">Set by ContextCaps</span>}
            </div>
          </div>
        </div>

        {unresolved && (
          <div className="conflict" role="group" aria-labelledby="conflict-title">
            <p className="conflict-head" id="conflict-title">
              <i className="ph-fill ph-warning" aria-hidden="true" />
              Your task and these values disagree
            </p>
            <p className="conflict-lead">Pick which ones to authorize. ContextCaps will not choose for you.</p>
            <table className="conflict-table">
              <thead>
                <tr><th scope="col">Field</th><th scope="col">In your task</th><th scope="col">Authorizing now</th></tr>
              </thead>
              <tbody>
                {conflicts.map((c) => (
                  <tr key={c.field}>
                    <th scope="row">{c.label}</th>
                    <td data-col="In your task">{c.fromTask}</td>
                    <td data-col="Authorizing now">{c.current}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="conflict-actions">
              <button type="button" className="btn btn-primary btn-sm" onClick={useTaskValues}>Use task values</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAcknowledged(signature)}>Keep current values</button>
            </div>
          </div>
        )}

        {principalMismatch && (
          <p className="callout callout-warn">
            <i className="ph ph-warning" aria-hidden="true" />
            The broker is on Monad. Set <code>VITE_PRINCIPAL</code> to the broker signer's wallet address.
          </p>
        )}

        {walletMode && !locked && (
          <p className="wallet-line">
            <i className="ph ph-wallet" aria-hidden="true" />
            {account ? (
              <>Signing as <code title={account}>{truncate(account, 6, 4)}</code>. Your wallet authorizes and revokes; the broker never holds your key.</>
            ) : (
              <>You sign the grant with your own wallet. The broker never holds your key.</>
            )}
          </p>
        )}

        {locked ? (
          <p className="lock-note">
            <i className="ph-fill ph-lock-simple" aria-hidden="true" />
            Authorized and locked. To change the task, destination or budget, reset the demo and authorize again.
          </p>
        ) : needsWallet ? (
          hasWallet() ? (
            <button className="btn btn-primary btn-block" type="button" onClick={onConnect} disabled={connecting}>
              <i className="ph ph-wallet" aria-hidden="true" />
              {connecting ? "Connecting…" : "Connect wallet"}
            </button>
          ) : (
            <p className="callout callout-warn">
              <i className="ph ph-warning" aria-hidden="true" />
              Install MetaMask to authorize on Monad.
            </p>
          )
        ) : (
          <>
            <button
              className="btn btn-primary btn-block"
              type="submit"
              disabled={busy || !health || unresolved || incomplete}
              aria-describedby={unresolved ? "conflict-title" : undefined}
            >
              {busy ? "Authorizing…" : onMonad ? "Authorize on Monad" : "Authorize task"}
              <i className="ph ph-arrow-right" aria-hidden="true" />
            </button>
            {busy && progress && <span className="progress">{progress}</span>}
            <p className="lock-note">
              <i className="ph ph-lock-simple" aria-hidden="true" />
              {unresolved
                ? "Resolve the difference above to authorize."
                : incomplete
                  ? "Set a destination and a budget to authorize."
                  : "This authorizes a purpose-bound capability, not your raw data."}
            </p>
          </>
        )}
      </form>

      <div className="tile tile-preview">
        <span className="eyebrow"><i className="ph ph-shield-check" aria-hidden="true" /> Authorization preview</span>
        <div className="perm-cols">
          <section className="perm-col is-allowed">
            <header className="perm-head">
              <span className="perm-badge"><i className="ph-fill ph-check" aria-hidden="true" /></span>
              <div>
                <h3>The agent can use</h3>
                <p>Only what's needed for this task.</p>
              </div>
            </header>
            <ul className="perm-list">
              {ALLOWED.map((item) => (
                <li key={item.label}>
                  <span className="perm-icon"><i className={`ph ${item.icon}`} aria-hidden="true" /></span>
                  {item.label}
                  <i className="ph-bold ph-check perm-mark" aria-hidden="true" />
                </li>
              ))}
            </ul>
          </section>

          <section className="perm-col is-blocked">
            <header className="perm-head">
              <span className="perm-badge"><i className="ph-fill ph-lock-simple" aria-hidden="true" /></span>
              <div>
                <h3>Protected from the agent</h3>
                <p>Your sensitive data stays private.</p>
              </div>
            </header>
            <ul className="perm-list">
              {WITHHELD.map((label) => (
                <li key={label}>
                  <span className="perm-icon"><i className="ph-fill ph-lock-simple" aria-hidden="true" /></span>
                  {label}
                </li>
              ))}
            </ul>
          </section>
        </div>

        <div className="cap-strip">
          {auth ? (
            <>
              <StatusBadge status={auth.capability.status} />
              <span>Capability <code>{auth.capability.capabilityId}</code></span>
              {txUrl ? (
                <a href={txUrl} target="_blank" rel="noreferrer">tx <code>{truncate(auth.chain.txHash)}</code> <i className="ph ph-arrow-up-right" aria-hidden="true" /></a>
              ) : (
                <span className="muted">tx <code>{truncate(auth.chain.txHash)}</code></span>
              )}
            </>
          ) : (
            <span className="muted">
              No capability yet. Authorizing registers one on {onMonad ? "Monad" : "the mock trust layer"}.
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
