import type { ReactNode } from "react";
import { CircleAlert } from "lucide-react";

/**
 * The shared building blocks of every screen. They render the classes the stylesheet already defines, so a screen moved
 * onto them looks the same and keeps its tests; new screens get the same structure without copying markup.
 */

/** A screen's title block: the area it belongs to, its name, one line on what it is for, and its main actions. */
export function PageHeader({ eyebrow, title, description, actions, className }: {
  eyebrow: ReactNode; title: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string;
}) {
  return <div className={"page-head" + (className ? " " + className : "")}>
    <div className="page-title"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1>{description != null && <p>{description}</p>}</div>
    {actions && <div className="page-head-actions">{actions}</div>}
  </div>;
}

/** A failed load or refused change, announced to screen readers; with a retry when there is one. */
export function ErrorBanner({ message, onRetry, retryLabel }: { message: ReactNode; onRetry?: () => void; retryLabel?: string }) {
  if (!message) return null;
  return <div className="error-banner" role="alert"><CircleAlert size={17}/><span>{message}</span>
    {onRetry && retryLabel && <button className="btn btn-secondary" type="button" onClick={onRetry}>{retryLabel}</button>}
  </div>;
}
