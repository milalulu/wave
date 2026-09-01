import { memo, useEffect, useMemo, useRef } from "react";
import { useApp } from "../app/stores";
import { useI18n } from "./I18nContext";
import type { LyricsResult } from "../core/lyrics/LyricsService";

export const LyricsBody = memo(function LyricsBody({
  lyrics,
  lyricsLoading,
  lyricsAutoscroll,
}: {
  lyrics: LyricsResult | null;
  lyricsLoading: boolean;
  lyricsAutoscroll: boolean;
}) {
  const { t } = useI18n();
  const position = useApp((s) => s.position);
  const storeDuration = useApp((s) => s.duration);
  const seek = useApp((s) => s.seek);
  const duration = storeDuration;
  const containerRef = useRef<HTMLDivElement>(null);

  const activeIndex = useMemo(() => {
    if (!lyrics?.synced) return -1;
    let idx = -1;
    for (let i = 0; i < lyrics.lines.length; i++) {
      const t2 = lyrics.lines[i].time;
      if (t2 !== undefined && t2 <= position) idx = i;
    }
    return idx;
  }, [lyrics, position]);

  const lineProgress = useMemo(() => {
    if (!lyrics?.synced || activeIndex < 0 || !lyrics.lines[activeIndex]?.time) return 0;
    const curr = lyrics.lines[activeIndex].time!;
    const next = lyrics.lines[activeIndex + 1]?.time ?? duration;
    if (next <= curr) return 1;
    return Math.min(1, (position - curr) / (next - curr));
  }, [lyrics, activeIndex, position, duration]);

  useEffect(() => {
    const container = containerRef.current;
    if (!lyricsAutoscroll || !container || activeIndex < 0) return;
    const el = container.querySelector(`[data-line="${activeIndex}"]`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeIndex, lyricsAutoscroll]);

  return (
    <div className="lyrics-body" ref={containerRef}>
      {lyricsLoading ? (
        <p className="lyrics-hint">{t("home").lyricsLoading}</p>
      ) : lyrics?.instrumental ? (
        <p className="lyrics-hint">{t("home").lyricsInstrumental}</p>
      ) : lyrics && lyrics.lines.length > 0 ? (
        lyrics.lines.map((line, i) => (
          <p
            key={i}
            data-line={i}
            className={`lyrics-line ${i === activeIndex ? "active" : ""} ${line.time !== undefined ? "clickable" : ""}`}
            onClick={() => line.time !== undefined && seek(line.time)}
            style={i === activeIndex && lyrics.synced ? { "--progress": lineProgress } as React.CSSProperties : undefined}
          >
            {line.text || "\u00A0"}
          </p>
        ))
      ) : (
        <p className="lyrics-hint">{t("home").lyricsNotFound}</p>
      )}
    </div>
  );
});
