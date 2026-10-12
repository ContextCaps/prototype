import { useState, type FormEvent } from "react";
import type { CreateMandateRequest, HealthResponse } from "../api/types";
import type { Authorization } from "../lib/useDemo";
import { explorerTxUrl, truncate } from "../lib/format";
import { hasWallet } from "../lib/wallet";
import { StatusBadge } from "./DecisionBadge";

const PRINCIPAL = import.meta.env.VITE_PRINCIPAL || "0xA11CE";
const GOLDEN_TASK = "Book my Singapore trip next weekend under $700.";

/** What the travel-booking template grants vs. withholds (docs/PERSON_3_PRODUCT.md P3-02). */
const ALLOWED = ["Passport eligibility", "Available travel window", "Hotel preferences", "Booking credentials at checkout"];
const WITHHELD = ["Raw passport", "Full calendar", "Salary", "Raw payment credentials"];

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

export function AuthorizeStep({ health, auth, busy, walletMode, account, connecting, progress, onConnect, onAuthorize }: Props) {
  const [description, setDescription] = useState(GOLDEN_TASK);
  const [destination, setDestination] = useState("Singapore");
  const [budget, setBudget] = useState(700);

  const onMonad = health?.provider === "monad";
  const principal = walletMode ? account : PRINCIPAL;
  const principalMismatch = onMonad && !walletMode && !/^0x[0-9a-fA-F]{40}$/.test(PRINCIPAL);
  const needsWallet = walletMode && !account;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!principal) return;
    onAuthorize({ principal, description, constraints: { destination, budgetUsd: budget } });
  };

  const txUrl = explorerTxUrl(health?.provider, auth?.chain.txHash);

  return (
    <div className="grid-2">
      <form className="tile" onSubmit={submit}>
        <span className="eyebrow"><i className="ph ph-chat-text" aria-hidden="true" /> Task</span>
        <label className="field">
          <span>What should the agent do?</span>
          <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} disabled={!!auth} />
        </label>
        <dl className="facts">
          <div><dt>Agent</dt><dd>Travel Agent</dd></div>
          <div>
            <dt>Destination</dt>
            <dd><input value={destination} onChange={(e) => setDestination(e.target.value)} disabled={!!auth} aria-label="Destination" /></dd>
          </div>
          <div>
            <dt>Budget</dt>
            <dd className="with-prefix">
              $<input type="number" min={1} value={budget} onChange={(e) => setBudget(Number(e.target.value))} disabled={!!auth} aria-label="Budget in USD" />
            </dd>
          </div>
          <div><dt>Purpose</dt><dd><code>travel-booking</code></dd></div>
        </dl>
        {principalMismatch && (
          <p className="callout callout-warn">
            <i className="ph ph-warning" aria-hidden="true" />
            The broker is on Monad. Set <code>VITE_PRINCIPAL</code> to the broker signer's wallet address.
          </p>
        )}
        {walletMode && (
          <p className="wallet-line">
            <i className="ph ph-wallet" aria-hidden="true" />
            {account ? (
              <>Signing as <code title={account}>{truncate(account, 6, 4)}</code>. Your wallet authorizes and revokes; the broker never holds your key.</>
            ) : (
              <>You sign the grant with your own wallet. The broker never holds your key.</>
            )}
          </p>
        )}
        {!auth &&
          (needsWallet ? (
            hasWallet() ? (
              <button className="btn btn-primary" type="button" onClick={onConnect} disabled={connecting}>
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
            <div className="submit-row">
              <button className="btn btn-primary" type="submit" disabled={busy || !health}>
                {busy ? "Authorizing…" : onMonad ? "Authorize on Monad" : "Authorize task"}
                <i className="ph ph-arrow-right" aria-hidden="true" />
              </button>
              {busy && progress && <span className="progress">{progress}</span>}
            </div>
          ))}
      </form>

      <div className="tile tile-preview">
        <span className="eyebrow"><i className="ph ph-shield-check" aria-hidden="true" /> Authorization preview</span>
        <div className="preview-cols">
          <div>
            <h3>Allowed</h3>
            <ul className="fields">
              {ALLOWED.map((x) => <li key={x}><i className="ph-bold ph-check" aria-hidden="true" />{x}</li>)}
            </ul>
          </div>
          <div>
            <h3>Not exposed</h3>
            <ul className="fields">
              {WITHHELD.map((x) => <li key={x} className="withheld"><i className="ph-bold ph-x" aria-hidden="true" />{x}</li>)}
            </ul>
          </div>
        </div>
        {auth && (
          <div className="cap-strip">
            <StatusBadge status={auth.capability.status} />
            <span>Capability <code>{auth.capability.capabilityId}</code></span>
            {txUrl ? (
              <a href={txUrl} target="_blank" rel="noreferrer">tx <code>{truncate(auth.chain.txHash)}</code> <i className="ph ph-arrow-up-right" aria-hidden="true" /></a>
            ) : (
              <span className="muted">tx <code>{truncate(auth.chain.txHash)}</code></span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
