import { useApp } from "../app/stores";

export function Toasts() {
  const notices = useApp((s) => s.notices);
  const dismiss = useApp((s) => s.dismissNotice);
  if (notices.length === 0) return null;
  return (
    <div className="toasts">
      {notices.map((n) => (
        <button key={n.id} className="toast" onClick={() => dismiss(n.id)}>
          {n.message}
        </button>
      ))}
    </div>
  );
}
