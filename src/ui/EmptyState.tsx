import type { ReactNode } from "react";

interface EmptyStateProps {
  icon?: ReactNode;
  title?: string;
  message?: string;
  action?: ReactNode;
  compact?: boolean;
}

export function EmptyState({ icon, title, message, action, compact }: EmptyStateProps) {
  const inner = (
    <>
      {icon ? <div className="empty-state-icon">{icon}</div> : null}
      {title ? <div className="empty-state-title">{title}</div> : null}
      {message ? <div className="empty-state-message">{message}</div> : null}
      {action ? <div className="empty-state-action">{action}</div> : null}
    </>
  );
  return <div className={compact ? "empty-state empty-state-compact" : "empty-state"}>{inner}</div>;
}
