import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { LyricsResult } from "../core/lyrics/LyricsService";
import { FullscreenIcon, FullscreenExitIcon, PlayIcon, PauseIcon } from "./icons";
import { formatTime } from "../core/util/format";

import { directLyrics, lyricsLook, moodGlyphs, sceneLooks, type LyricsCue } from "./lyricsDirection";
import { particleCount, sampleParticle } from "./lyricsMotion";
import { motifs } from "./lyricsMotifs";
import { activeAtmospheres, firstWordOffset, lyricLength as letterCount, planAtmospheres, sweepLength } from "./lyricsAtmosphere";
import { LyricsAtmosphere } from "./LyricsAtmosphereCanvas";
import type { LyricsAppearance } from "../app/lyricsAppearance";

function Reaction({ cue, elapsed }: { cue: LyricsCue; elapsed: number }) {
  const phase = elapsed / (cue.mood === "quiet" || cue.mood === "shadow" ? 1.6 : 1.22);
  if (phase < 0 || phase >= 1) return null;
  const pulse = clamp(phase / 0.22) * (1 - phase) ** 1.8;
  const art = cue.motif && motifs[cue.motif];
  return <span className="lyrics-reaction" data-reaction={cue.reaction} data-motif={cue.motif}
    style={art ? { "--motif-color": art.color } as CSSProperties : undefined} aria-hidden="true">
    <span className="lyrics-particles">
      {Array.from({ length: particleCount }, (_, index) => {
        const { x, y, turn, size, opacity } = sampleParticle(cue, index, phase);
        return <i key={index} style={{
          "--x": `${x.toFixed(2)}%`, "--y": `${y.toFixed(2)}%`, "--angle": `${turn}deg`,
          "--particle-size": size, opacity,
        } as CSSProperties}>{art ? art.glyph : moodGlyphs[cue.mood]}</i>;
      })}
    </span>
    <b className="lyrics-reaction-pulse" style={{
      "--pulse-scale": 0.34 + phase * 0.66,
      opacity: pulse,
    } as CSSProperties} />
  </span>;
}

const clamp = (value: number) => Math.max(0, Math.min(1, value));

function tokenize(text: string) {
  return text.split(/(\s+)/u).map((word) => ({ word, count: letterCount(word) }));
}

function splitCues(text: string, cues: readonly LyricsCue[]) {
  let cursor = 0;
  const segments: { text: string; cue?: LyricsCue }[] = [];
  for (const cue of cues) {
    segments.push({ text: text.slice(cursor, cue.start) }, { text: text.slice(cue.start, cue.end), cue });
    cursor = cue.end;
  }
  segments.push({ text: text.slice(cursor) });
  return segments.filter((segment) => segment.text);
}

function paintWords(tokens: ReturnType<typeof tokenize>, litLetters: number) {
  let remaining = litLetters;
  return tokens.map(({ word, count }, index) => {
    if (!count) return word;
    const fill = clamp(remaining / count);
    remaining -= count;
    return <span key={index} className="lyrics-karaoke-word" style={{ "--word-fill": `${fill * 100}%` } as CSSProperties}>{word}</span>;
  });
}

type ScenePart = { text: string; lit: number; cue?: LyricsCue; since?: number };

export function LyricsScene({ lyrics, activeIndex, position, seek, preparing, controls, appearance }: {
  lyrics: LyricsResult;
  activeIndex: number;
  position: number;
  seek: (time: number) => void;
  preparing: string;
  appearance?: LyricsAppearance;
  controls?: { locale: string; playing: boolean; togglePlay: () => void; duration: number };
}) {
  const stage = useRef<HTMLElement>(null);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const sync = () => setExpanded(document.fullscreenElement === stage.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement === stage.current) void document.exitFullscreen().catch(() => {});
    else void stage.current?.requestFullscreen?.().catch(() => {});
  };
  const line = lyrics.lines[activeIndex];
  const direction = useMemo(() => directLyrics(lyrics.trackId, lyrics.lines), [lyrics.trackId, lyrics.lines]);
  const schedule = useMemo(() => planAtmospheres(lyrics.lines, direction, controls?.duration), [lyrics.lines, direction, controls?.duration]);
  const effects = appearance?.effects !== false;
  const atmospheres = effects ? activeAtmospheres(schedule, position) : [];
  const look = lyricsLook(lyrics.trackId, effects ? activeIndex : 0);
  const { text, words, segments } = useMemo(() => {
    const text = line?.text.trim() ?? "";
    const cues = direction[activeIndex] ?? [];
    let offset = firstWordOffset(line?.words);
    const words = line?.words?.map((word) => {
      const start = offset;
      offset += word.text.length;
      const wordCues = cues.filter((cue) => cue.start >= start && cue.end <= offset)
        .map((cue) => ({ ...cue, start: cue.start - start, end: cue.end - start }));
      return { ...word, segments: wordCues.length ? splitCues(word.text, wordCues) : null };
    });
    return { text, words, segments: splitCues(text, cues) };
  }, [line, direction, activeIndex]);
  const { next, previous } = useMemo(() => {
    let nextIndex = activeIndex + 1;
    let previous = activeIndex - 1;
    while (nextIndex < lyrics.lines.length && !lyrics.lines[nextIndex].text.trim()) nextIndex++;
    while (previous >= 0 && !lyrics.lines[previous].text.trim()) previous--;
    return { next: lyrics.lines[nextIndex], previous };
  }, [lyrics.lines, activeIndex]);
  const elapsed = Math.max(0, position - (line?.time ?? position));
  const lineEnd = next?.time ?? controls?.duration;
  const lineLength = line?.time !== undefined && lineEnd !== undefined && lineEnd > line.time
    ? lineEnd - line.time : 3;
  const transition = clamp(elapsed / Math.min(0.72, lineLength * 0.48));
  const motion = !effects || line?.time === undefined ? 1 : transition * transition * (3 - 2 * transition);
  const duration = sweepLength(line?.time ?? position, lineEnd);
  const total = letterCount(text);
  let consumed = 0;
  const parts: ScenePart[] = words?.length ? words.flatMap((word) => {
    const end = word.end ?? Math.min(lineEnd ?? Infinity, word.time + 0.55);
    const span = Math.max(0.06, end - word.time);
    const count = Math.max(1, letterCount(word.text));
    const lit = clamp((position - word.time) / span) * count;
    let before = 0;
    return (word.segments ?? [{ text: word.text }]).map(({ text, cue }) => {
      const part = { text, lit: lit - before, cue, since: position - word.time - before / count * span };
      before += letterCount(text);
      return part;
    });
  }) : segments.map(({ text, cue }) => {
    const part = { text, cue, lit: clamp(elapsed / duration) * total - consumed, since: elapsed - consumed / Math.max(1, total) * duration };
    consumed += letterCount(text);
    return part;
  });
  const accentSpan = (cue: LyricsCue, since: number, content: ReactNode) => (
    <span className="lyrics-scene-word" data-word-mood={cue.mood} data-cued={since >= 0}>
      {effects && line?.time !== undefined && <Reaction cue={cue} elapsed={since} />}
      <span className="lyrics-scene-word-ink">{content}</span>
    </span>
  );
  const mood = direction[activeIndex]?.[0]?.mood ?? "neutral";

  const ru = controls?.locale === "ru";
  const fullLabel = expanded ? (ru ? "Свернуть сцену" : "Exit full screen") : (ru ? "Сцена на весь экран" : "Full screen scene");
  const playLabel = controls?.playing ? (ru ? "Пауза" : "Pause") : (ru ? "Играть" : "Play");
  const progress = controls?.duration ? Math.min(1, Math.max(0, position / controls.duration)) : 0;
  return <section ref={stage} className="lyrics-scene" data-mood={effects ? mood : "neutral"} data-look={look}
    data-lyrics-size={appearance?.size} data-lyrics-font={appearance?.font} data-effects={effects} aria-label={lyrics.title}>
    {atmospheres.length > 0 && <LyricsAtmosphere events={atmospheres} position={position} />}
    <div className="lyrics-scene-light" aria-hidden="true" />
    {sceneLooks.map((look) => <div key={look} className="lyrics-scene-set" data-set={look} aria-hidden="true" />)}
    {controls && <header className="lyrics-cinema-header">
      <span className="lyrics-scene-track" dir="auto">{lyrics.title}{lyrics.artist && ` · ${lyrics.artist}`}</span>
      <button type="button" className="icon-btn" onClick={toggleFullscreen} title={fullLabel} aria-label={fullLabel}>
        {expanded ? <FullscreenExitIcon size={18} /> : <FullscreenIcon size={18} />}
      </button>
    </header>}
    <div className="lyrics-scene-content" style={{
      "--line-opacity": 0.46 + motion * 0.54,
      "--line-rise": `${(1 - motion) * 12}px`,
      "--outgoing-opacity": 0.28 * (1 - motion) ** 3,
      "--outgoing-rise": `${-motion * 24}px`,
      "--outgoing-blur": `${3 + motion * 7}px`,
      "--previous-rise": `${(1 - motion) * 10}px`,
      "--previous-opacity": 0.42 * motion,
      "--previous-blur": `${(2 - motion) * 1.5}px`,
      "--context-opacity": 0.25 + motion * 0.45,
      "--context-rise": `${(1 - motion) * 5}px`,
    } as CSSProperties}>
      {previous >= 0 && <p className="lyrics-scene-previous" dir="auto">{lyrics.lines[previous].text}</p>}
      {previous >= 0 && motion < 1 && (
        <p className="lyrics-scene-line lyrics-scene-outgoing" dir="auto" aria-hidden="true">
          {lyrics.lines[previous].text}
        </p>
      )}
      <p className="lyrics-scene-line" dir="auto">
        {parts.length ? parts.map(({ text, lit, cue, since = 0 }, index) => {
          const highlighted = paintWords(tokenize(text), lit);
          if (!cue) return <span key={index}>{highlighted}</span>;
          const accent = accentSpan(cue, since, highlighted);
          const following = parts[index + 1];
          const punctuation = following?.text.match(/^[,.;:!?…»”)\]}]+/u)?.[0];
          if (!punctuation) return <span key={index}>{accent}</span>;
          const suffix = paintWords(tokenize(punctuation), following.lit);
          parts[index + 1] = { ...following, text: following.text.slice(punctuation.length), lit: following.lit - letterCount(punctuation) };
          return <span key={index} className="lyrics-scene-word-unit">{accent}{suffix}</span>;
        }) : (activeIndex < 0 ? preparing : "♪")}
      </p>
      {next && (next.time === undefined
        ? <span className="lyrics-scene-next">{next.text}</span>
        : <button type="button" className="lyrics-scene-next" onClick={() => seek(next.time!)}>{next.text}</button>)}
    </div>
    {controls && <footer className="lyrics-cinema-footer">
      <button type="button" className="icon-btn" onClick={controls.togglePlay} title={playLabel} aria-label={playLabel}>
        {controls.playing ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
      </button>
      <span>{formatTime(position)}</span>
      <span className="lyrics-cinema-progress" aria-hidden="true"><i style={{ transform: `scaleX(${progress})` }} /></span>
      <span>{formatTime(controls.duration)}</span>
    </footer>}
  </section>;
}
