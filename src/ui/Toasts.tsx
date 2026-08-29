import { useApp } from "../app/stores";

export function Toasts() {
  const notices = useApp((s) => s.notices);
  const dismiss = useApp((s) => s.dismissNotice);
  return (
    <div className="toasts" role="status" aria-live="polite" aria-atomic="false">
      {notices.map((n) => (
        <div key={n.id} className="toast">
          <span className="toast-msg" onClick={() => dismiss(n.id)}>
            {n.message}
          </span>
          {n.actionLabel && n.onAction ? (
            <button
              className="toast-action"
              onClick={(e) => {
                e.stopPropagation();
                n.onAction?.();
                dismiss(n.id);
              }}
            >
              {n.actionLabel}
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
