import type { ReactNode } from "react";

interface StepProps {
  className?: string;
  n: number;
  title: string;
  lead?: string;
  locked?: string | false;
  aside?: ReactNode;
  children: ReactNode;
}

/** One numbered scene of the golden flow. Locked steps stay visible but explain what unlocks them. */
export function Step({ n, title, lead, locked, aside, children, className }: StepProps) {
  return (
    <section className={`step${locked ? " is-locked" : ""}${className ? ` ${className}` : ""}`} aria-labelledby={`step-${n}`}>
      <header className="step-head">
        <span className="step-num" aria-hidden="true">{n}</span>
        <div className="step-title">
          <h2 id={`step-${n}`}>{title}</h2>
          {lead && <p>{lead}</p>}
        </div>
        {aside && <div className="step-aside">{aside}</div>}
      </header>
      {locked ? <p className="step-locked"><i className="ph ph-lock-simple" aria-hidden="true" /> {locked}</p> : children}
    </section>
  );
}
