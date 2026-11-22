import { SpinnerIcon } from "./icons";
import { useI18n } from "./I18nContext";

export function LoadingState() {
  const { t } = useI18n();
  return <div className="pulse-loading" role="status" aria-live="polite"><SpinnerIcon size={24} /><span>{t("common").loading}</span><div className="pulse-loading-lines" aria-hidden="true"><i /><i /><i /></div></div>;
}
