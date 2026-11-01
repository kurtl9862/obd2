import type { CSSProperties, ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

interface CardProps {
  title: string;
  icon?: ReactNode;
  /** token name from styles.css, e.g. "coral" */
  accent?: string;
  actions?: ReactNode;
  error?: string | null;
  className?: string;
  children?: ReactNode;
}

/** Shared frame for every panel: header, actions, error banner. Same look as Halberd's cards. */
export function Card({ title, icon, accent, actions, error, className, children }: CardProps) {
  const style = accent ? ({ '--accent': `var(--${accent})` } as CSSProperties) : undefined;
  return (
    <section className={`card ${className ?? ''}`} style={style}>
      <header className="card-head">
        {icon && <span className="card-icon">{icon}</span>}
        <h2>{title}</h2>
        {actions && <div className="card-actions">{actions}</div>}
      </header>
      {error && (
        <div className="card-error" role="alert">
          <AlertTriangle size={14} />
          <span>{error}</span>
        </div>
      )}
      {children}
    </section>
  );
}
