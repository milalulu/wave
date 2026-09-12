import { useEffect, useRef } from "react";
import { useI18n } from "./I18nContext";

interface ConfirmDialogProps {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ message, onConfirm, onCancel }: ConfirmDialogProps) {
  const { t } = useI18n();
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="confirm-overlay" onClick={onCancel}>
      <div className="confirm-dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <p>{message}</p>
        <div className="confirm-actions">
          <button className="btn" ref={cancelRef} onClick={onCancel}>{t("playlist").cancel}</button>
          <button className="btn btn-danger" onClick={onConfirm}>{t("common").delete}</button>
        </div>
      </div>
    </div>
  );
}