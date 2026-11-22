import { useState } from "react";
import { getPlaybackHandoff, resumePlaybackHandoff, savePlaybackCheckpoint } from "../app/syncEngine";
import type { PlaybackStateSync } from "../app/supabase";
import { formatTime } from "../core/util/format";
import { useI18n } from "./I18nContext";

export function PlaybackHandoff({ userId }: { userId: string }) {
  const { locale } = useI18n();
  const ru = locale === "ru";
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [remote, setRemote] = useState<PlaybackStateSync | null>(null);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setStatus("");
    try { await action(); }
    catch { setStatus(ru ? "Не удалось синхронизировать воспроизведение" : "Playback sync failed"); }
    finally { setBusy(false); }
  }

  return <div>
    <div className="settings-action-row">
      <button type="button" className="btn small" disabled={busy} onClick={() => void run(async () => {
        const saved = await savePlaybackCheckpoint(userId);
        setStatus(saved ? (ru ? "Позиция сохранена" : "Position saved")
          : (ru ? "Сначала включи трек с YouTube Music или SoundCloud" : "Start a YouTube Music or SoundCloud track first"));
      })}>{ru ? "Сохранить позицию" : "Save position"}</button>
      <button type="button" className="btn small" disabled={busy} onClick={() => void run(async () => {
        const state = await getPlaybackHandoff(userId);
        setRemote(state);
        if (!state) setStatus(ru ? "Новой позиции с другого устройства нет" : "No newer position from another device");
      })}>{ru ? "Проверить позицию с другого устройства" : "Find a position from another device"}</button>
      {remote?.track && <button type="button" className="btn small" disabled={busy} onClick={() => void run(async () => {
        await resumePlaybackHandoff(remote);
        setRemote(null);
      })}>{ru ? "Продолжить" : "Continue"} · {remote.track.title} · {formatTime(remote.position)}</button>}
    </div>
    {status && <p className="muted" role="status">{status}</p>}
  </div>;
}
