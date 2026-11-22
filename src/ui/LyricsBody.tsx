import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useApp } from "../app/stores";
import { useI18n } from "./I18nContext";
import type { LyricsLine, LyricsResult } from "../core/lyrics/LyricsService";
import { LyricsScene } from "./LyricsScene";
import { useLyricsAppearance } from "../app/lyricsAppearance";
import { LyricsAppearanceControls } from "./LyricsAppearanceControls";

const LyricsReadingLine = memo(function LyricsReadingLine({ line, index, active, position, lineEnd, byWord, seek }: {
  line: LyricsLine; index: number; active: boolean; position: number; lineEnd: number; byWord: boolean; seek: (time: number) => void;
}) {
  const words = byWord && active && line.words?.length ? line.words : undefined;
  const start = line.time;
  const progress = start === undefined || !active ? 0 : lineEnd <= start ? 1 : (position - start) / (lineEnd - start);
  const className = `lyrics-line${active ? " active" : ""}${start !== undefined ? " clickable" : ""}`;
  const content = words ? words.map((word, index) => {
    const end = word.end ?? words[index + 1]?.time ?? Math.min(lineEnd, word.time + .55);
    const fill = Math.max(0, Math.min(1, (position - word.time) / Math.max(.06, end - word.time)));
    return <span key={index} className="lyrics-inline-word" style={{ "--word-fill": `${fill * 100}%` } as CSSProperties}>{word.text}</span>;
  }) : line.text || "\u00a0";
  return start === undefined
    ? <p data-line={index} dir="auto" className={className}>{content}</p>
    : <button type="button" data-line={index} data-wordwise={Boolean(words)} dir="auto" className={className}
        aria-current={active || undefined} aria-label={line.text || undefined} onClick={() => seek(start)}
        style={active && !words ? { "--progress": Math.max(0, Math.min(1, progress)) } as CSSProperties : undefined}>
        {content}
      </button>;
});

export const LyricsBody = memo(function LyricsBody({
  lyrics,
  lyricsLoading,
  lyricsAutoscroll,
}: {
  lyrics: LyricsResult | null;
  lyricsLoading: boolean;
  lyricsAutoscroll: boolean;
}) {
  const { t, locale } = useI18n();
  const appearance = useLyricsAppearance((s) => s.appearance);
  const [scene, setScene] = useState(false);
  const reportedPosition = useApp((s) => s.position);
  const engine = useApp((s) => s.services?.engine);
  const playing = useApp((s) => s.snapshot.state === "playing");
  const togglePlay = useApp((s) => s.togglePlay);
  const [livePosition, setLivePosition] = useState<number>();
  const storeDuration = useApp((s) => s.duration);
  const seek = useApp((s) => s.seek);
  const duration = storeDuration;
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneOpen = Boolean(scene && !lyricsLoading && lyrics?.synced && !lyrics.instrumental);
  const wordTimings = useMemo(() => Boolean(lyrics?.synced && lyrics.lines.some((line) => line.words?.length)), [lyrics]);
  const wordMode = appearance.timing === "word" && wordTimings;
  const live = (sceneOpen || wordMode) && playing && !lyricsLoading;
  const position = live ? livePosition ?? reportedPosition : reportedPosition;

  useEffect(() => {
    if (!live || !engine) return;
    let frame = 0;
    const tick = () => {
      setLivePosition(engine.getPlaybackPosition());
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [live, engine, lyrics?.trackId]);

  const timings = useMemo(() => lyrics?.synced
    ? lyrics.lines.flatMap(({ time }, index) => time === undefined ? [] : [{ time, index }])
    : [], [lyrics]);
  const activeIndex = useMemo(() => {
    let left = 0;
    let right = timings.length;
    while (left < right) {
      const middle = (left + right) >>> 1;
      if (timings[middle].time <= position) left = middle + 1;
      else right = middle;
    }
    return timings[left - 1]?.index ?? -1;
  }, [timings, position]);

  useEffect(() => {
    const container = containerRef.current;
    if (!lyricsAutoscroll || !container || activeIndex < 0) return;
    const el = container.querySelector(`[data-line="${activeIndex}"]`);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el?.scrollIntoView({ block: "center", behavior: reducedMotion ? "auto" : "smooth" });
  }, [activeIndex, lyricsAutoscroll, scene, appearance.size, appearance.font]);

  const canShowScene = !lyricsLoading && lyrics?.synced && !lyrics.instrumental && lyrics.lines.some((line) => line.time !== undefined && line.text.trim());

  return (
    <>
      {!lyricsLoading && !lyrics?.instrumental && Boolean(lyrics?.lines.length) && <div className="lyrics-scene-switch">
        {canShowScene && <>
          <button className="btn small" type="button" aria-pressed={!sceneOpen} onClick={() => setScene(false)}>{locale === "ru" ? "Текст" : "Lyrics"}</button>
          <button className="btn small" type="button" aria-pressed={sceneOpen} onClick={() => setScene(true)}>{locale === "ru" ? "Сцена" : "Scene"}</button>
        </>}
        <LyricsAppearanceControls locale={locale} wordTimings={wordTimings} />
      </div>}
      {sceneOpen && canShowScene && lyrics ? <LyricsScene lyrics={lyrics} activeIndex={activeIndex} position={position} seek={seek}
        appearance={appearance} preparing={locale === "ru" ? "До первой строки" : "Until the first line"} controls={{ locale, playing, togglePlay, duration }} /> : (
    <div className="lyrics-body" data-lyrics-size={appearance.size} data-lyrics-font={appearance.font} ref={containerRef}>
      {lyricsLoading ? (
        <p className="lyrics-hint">{t("home").lyricsLoading}</p>
      ) : lyrics?.instrumental ? (
        <p className="lyrics-hint">{t("home").lyricsInstrumental}</p>
      ) : lyrics && lyrics.lines.length > 0 ? (
        lyrics.lines.map((line, i) => (
          <LyricsReadingLine key={i} index={i} line={line} active={i === activeIndex} position={i === activeIndex ? position : 0}
            lineEnd={lyrics.lines[i + 1]?.time ?? duration} byWord={wordMode} seek={seek} />
        ))
      ) : (
        <p className="lyrics-hint">{t("home").lyricsNotFound}</p>
      )}
    </div>
      )}
    </>
  );
});
