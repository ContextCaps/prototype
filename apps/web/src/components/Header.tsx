import type { HealthResponse } from "../api/types";
import type { WalletSession } from "../lib/WalletContext";
import { truncate } from "../lib/format";

interface HeaderProps {
  health: HealthResponse | null;
  healthError: string | null;
  resetting: boolean;
  onReset: () => void;
  onRecheck: () => void;
  wallet: WalletSession;
  walletBusy: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}

export function Header({ health, healthError, resetting, onReset, onRecheck, wallet, walletBusy, onConnect, onDisconnect }: HeaderProps) {
  const network = health ? (health.provider === "monad" ? "Monad Testnet" : "Mock trust layer") : null;
  return (
    <header className="site-header">
      <nav className="nav container" aria-label="Console">
        <a className="brand" href="/" aria-label="ContextCaps console">
          <img src="/logo-mark.png" alt="" width="40" height="40" />
          <span>ContextCaps</span>
        </a>
        <div className="nav-actions">
          {wallet.kind === "privy" && (
            <div className="wallet-nav">
              {wallet.account && <span className="pill pill-sm" title={wallet.account}>Privy · {truncate(wallet.account, 6, 4)}</span>}
              <button type="button" className="btn btn-ghost" disabled={walletBusy || !wallet.ready || !wallet.available} onClick={wallet.authenticated ? onDisconnect : onConnect}>
                {wallet.authenticated ? "Log out" : "Log in with Privy"}
              </button>
            </div>
          )}
          {health ? (
            <span className="pill pill-sm" title="Broker connection">
              <span className={`pill-dot${health.provider === "monad" ? "" : " is-mock"}`} aria-hidden="true" />
              {network}
            </span>
          ) : (
            <button type="button" className="pill pill-sm pill-error" onClick={onRecheck} title={healthError ?? undefined}>
              <i className="ph ph-plugs" aria-hidden="true" />
              {healthError ? "Broker offline · retry" : "Connecting…"}
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={onReset} disabled={resetting}>
            <i className="ph ph-arrow-counter-clockwise" aria-hidden="true" />
            {resetting ? "Resetting…" : "Reset demo"}
          </button>
        </div>
      </nav>
    </header>
  );
}
