import { useEffect, useId, useRef } from "react";
import { useI18n } from "./I18nContext";

interface ConfirmDialogProps {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
}

export function ConfirmDialog({ message, onConfirm, onCancel, confirmLabel }: ConfirmDialogProps) {
  const { t } = useI18n();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const messageId = useId();

  useEffect(() => {
    const previousFocus = document.activeElement;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onCancel(); }
      if (e.key === "Tab") {
        const buttons = dialogRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
        if (!buttons?.length) return;
        const first = buttons[0], last = buttons[buttons.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [onCancel]);

  return (
    <div className="confirm-overlay" onClick={onCancel}>
      <div className="confirm-dialog" ref={dialogRef} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby={messageId}>
        <p id={messageId}>{message}</p>
        <div className="confirm-actions">
          <button className="btn" ref={cancelRef} onClick={onCancel}>{t("playlist").cancel}</button>
          <button className={`btn ${confirmLabel ? "btn-primary" : "btn-danger"}`} onClick={onConfirm}>{confirmLabel ?? t("common").delete}</button>
        </div>
      </div>
    </div>
  );
}
