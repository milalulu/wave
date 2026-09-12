import { useRef, useState } from "react";
import { useApp } from "../app/stores";
import { useI18n } from "./I18nContext";
import { usePopoverDismiss } from "./usePopoverDismiss";
import { MoonIcon } from "./icons";

function formatRemaining(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Кнопка слип-тапмера с меню: переиспользуется в PlayerBar и NowPlaying. */
export function SleepControl() {
  const { t, tf } = useI18n();
  const sleepUntil = useApp((s) => s.sleepUntil);
  const sleepRemaining = useApp((s) => s.sleepRemaining);
  const pauseAfterTrack = useApp((s) => s.pauseAfterTrack);
  const setSleepMinutes = useApp((s) => s.setSleepMinutes);
  const setSleepAfterTrack = useApp((s) => s.setSleepAfterTrack);
  const clearSleep = useApp((s) => s.clearSleep);
  const [sleepOpen, setSleepOpen] = useState(false);
  const sleepRef = useRef<HTMLDivElement>(null);
  usePopoverDismiss(sleepRef, sleepOpen, () => setSleepOpen(false));

  const sleepActive = sleepUntil !== null || pauseAfterTrack;
  const sleepLabel = pauseAfterTrack
    ? t("player").sleepTimerOptions.afterTrack
    : sleepRemaining > 0
      ? formatRemaining(sleepRemaining)
      : "";

  return (
    <div className="sleep-menu-wrap" ref={sleepRef}>
      <button
        className={`icon-btn ${sleepActive ? "active" : ""}`}
        onClick={() => setSleepOpen((o) => !o)}
        title={sleepActive ? `${t("player").sleepTimer}: ${sleepLabel}` : t("player").sleepTimer}
      >
        <MoonIcon size={18} />
      </button>
      {sleepActive && <span className="sleep-badge">{sleepLabel}</span>}
      {sleepOpen && (
        <div className="sleep-menu" onClick={(e) => e.stopPropagation()}>
          <div className="sleep-menu-title">{t("player").sleepTimer}</div>
          {[15, 30, 60, 90].map((m) => (
            <button
              key={m}
              onClick={() => {
                setSleepMinutes(m);
                setSleepOpen(false);
              }}
            >
              {tf("player").sleepTimerOptions.minutes(m)}
            </button>
          ))}
          <div className="sleep-custom">
            <input
              type="number"
              min={1}
              max={480}
              placeholder="..."
              className="sleep-custom-input"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const val = Number((e.target as HTMLInputElement).value);
                  if (val > 0) { setSleepMinutes(val); setSleepOpen(false); }
                }
              }}
            />
            <button
              className="btn small"
              onClick={(e) => {
                const input = (e.currentTarget.previousElementSibling as HTMLInputElement);
                const val = Number(input?.value);
                if (val > 0) { setSleepMinutes(val); setSleepOpen(false); }
              }}
            >
              OK
            </button>
          </div>
          <button
            onClick={() => {
              setSleepAfterTrack();
              setSleepOpen(false);
            }}
          >
            {t("player").sleepTimerOptions.afterTrack}
          </button>
          {sleepActive && (
            <button className="danger" onClick={() => { clearSleep(); setSleepOpen(false); }}>
              {t("player").sleepTimerOptions.off}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
