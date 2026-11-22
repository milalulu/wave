import type { ButtonHTMLAttributes, ReactNode } from "react";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  active?: boolean;
  loading?: boolean;
  children: ReactNode;
}

export function IconButton({ label, active, loading, className = "", disabled, children, ...props }: IconButtonProps) {
  return <button {...props} type={props.type ?? "button"} className={`icon-btn ${active ? "active" : ""} ${className}`} aria-label={label} title={label} aria-busy={loading || undefined} disabled={disabled || loading}>{children}</button>;
}
