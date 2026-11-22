import { useEffect, useState } from "react";
import { clearOfflineCache, getOfflineCacheUsage } from "../app/offlineCache";
import { useI18n } from "./I18nContext";
import { ConfirmDialog } from "./ConfirmDialog";

export function OfflineCacheControls() {
  const { locale } = useI18n();
  const ru = locale === "ru";
  const [usage, setUsage] = useState<Awaited<ReturnType<typeof getOfflineCacheUsage>> | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let mounted = true;
    const update = () => void getOfflineCacheUsage().then((value) => {
      if (mounted) setUsage(value);
    }, () => { if (mounted) setError(true); });
    update();
    const interval = window.setInterval(update, 5000);
    return () => { mounted = false; window.clearInterval(interval); };
  }, []);

  async function clear() {
    setConfirm(false);
    setBusy(true);
    setError(false);
    try { await clearOfflineCache(); setUsage(await getOfflineCacheUsage()); }
    catch { setError(true); }
    finally { setBusy(false); }
  }

  return <div className="settings-action-row">
    <span role="status" className="muted">{error ? (ru ? "Автокэш недоступен" : "Cache unavailable") : usage &&
      `${usage.tracks} ${ru ? "треков" : "tracks"} · ${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(usage.bytes / 1048576)} ${ru ? "МиБ" : "MiB"}`}</span>
    <button className="btn secondary" type="button" disabled={busy || !usage?.tracks} onClick={() => setConfirm(true)}>
      {ru ? "Очистить автокэш" : "Clear auto cache"}
    </button>
    {confirm && <ConfirmDialog message={ru ? "Удалить треки из автокэша? Ручные загрузки сохранятся." : "Remove cached tracks? Manual downloads will be kept."}
      onCancel={() => setConfirm(false)} onConfirm={() => void clear()} />}
  </div>;
}
