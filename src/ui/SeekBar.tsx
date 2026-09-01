import { memo } from "react";
import { useApp } from "../app/stores";
import { useI18n } from "./I18nContext";
import { formatTime } from "../core/util/format";
import type { Track } from "../core/types";

export const SeekBar = memo(function SeekBar({ track }: { track: Track | null }) {
  const { t } = useI18n();
  const position = useApp((s) => s.position);
  const storeDuration = useApp((s) => s.duration);
  const seek = useApp((s) => s.seek);
  const duration = track?.duration ?? storeDuration;
  const pct = duration ? (Math.min(position, duration) / duration) * 100 : 0;
  return (
    <div className="player-progress">
      <span className="time">{formatTime(position)}</span>
      <input
        type="range"
        className="seek"
        min={0}
        max={duration || 100}
        step={1}
        value={Math.min(position, duration || 0)}
        disabled={!track}
        aria-label={t("player").seek}
        style={{ "--seek-pct": `${pct}%` } as React.CSSProperties}
        onChange={(e) => seek(Number(e.target.value))}
      />
      <span className="time">{formatTime(duration)}</span>
    </div>
  );
});
