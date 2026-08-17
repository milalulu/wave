import { useEffect, useMemo, useRef } from "react";
import type { ViewKey } from "./Sidebar";
import { useApp } from "../app/stores";
import { useI18n } from "./I18nContext";
import { Cover } from "./Cover";
import { providerLabel } from "./providers";
import { useSwipeDown } from "./gestures";
import { HeartIcon, ChevronDownIcon, LyricsIcon, NextIcon, PauseIcon, PlayIcon, PreviousIcon, SearchIcon, WaveIcon } from "./icons";

function formatTime(seconds?: number): string {
  if (!seconds || !Number.isFinite(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

interface NowPlayingViewProps {
  onNavigate: (view: ViewKey) => void;
}

export function NowPlayingView({ onNavigate }: NowPlayingViewProps) {
  const { t, tf } = useI18n();
  const swipeDownRef = useSwipeDown<HTMLDivElement>(() => onNavigate("home"));
  const snapshot = useApp((s) => s.snapshot);
  const position = useApp((s) => s.position);
  const duration = useApp((s) => s.duration);
  const likedIds = useApp((s) => s.likedIds);
  const lyrics = useApp((s) => s.lyrics);
  const lyricsLoading = useApp((s) => s.lyricsLoading);
  const lyricsOpen = useApp((s) => s.lyricsOpen);
  const lyricsAutoscroll = useApp((s) => s.lyricsAutoscroll);
  const togglePlay = useApp((s) => s.togglePlay);
  const next = useApp((s) => s.next);
  const previous = useApp((s) => s.previous);
  const toggleLike = useApp((s) => s.toggleLike);
  const toggleLyrics = useApp((s) => s.toggleLyrics);
  const reloadLyrics = useApp((s) => s.reloadLyrics);
  const openLocalDirectory = useApp((s) => s.openLocalDirectory);
  const startWave = useApp((s) => s.startWave);
  const startRadio = useApp((s) => s.startRadio);
  const radioActive = useApp((s) => s.radioActive);
  const seek = useApp((s) => s.seek);

  const track = snapshot.current;
  const liked = track ? likedIds.includes(track.id) : false;

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

  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = containerRef.current;
    if (!lyricsAutoscroll || !container || activeIndex < 0) return;
    const el = container.querySelector(`[data-line="${activeIndex}"]`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeIndex, lyricsOpen, lyricsAutoscroll]);

  const handleLineClick = (line: { time?: number }) => {
    if (line.time !== undefined) seek(line.time);
  };

  return (
    <div className="home" ref={swipeDownRef}>
      <div className="np-collapse">
        <button
          className="icon-btn"
          onClick={() => onNavigate("home")}
          title={t("common").close}
        >
          <ChevronDownIcon size={22} />
        </button>
      </div>
      {track ? (
        <div className="hero">
          <div className="hero-cover">
            {track.coverUrl ? (
              <Cover src={track.coverUrl} alt="" />
            ) : (
              <div className="hero-cover-empty">{track.title?.charAt(0) ?? "W"}</div>
            )}
          </div>
          <div className="hero-info">
            <span className="hero-label">{t("app").nowPlaying}</span>
            <h1>{track.title}</h1>
            <p className="hero-artist">{track.artist}</p>
            <div className="hero-meta">
              {track.album && (
                <span className="hero-meta-item">
                  {t("home").album}: <b>{track.album}</b>
                </span>
              )}
              {track.year ? (
                <span className="hero-meta-item">
                  {t("home").year}: <b>{track.year}</b>
                </span>
              ) : null}
              {track.genre && (
                <span className="hero-meta-item">
                  {track.genre}
                </span>
              )}
              <span className="hero-meta-item">
                <span className={`provider-badge provider-${track.provider}`}>
                  {providerLabel(track.provider)}
                </span>
              </span>
            </div>
            <div className="hero-meta">
              <span className="hero-meta-item">
                {formatTime(position)} / {formatTime(duration)}
                {snapshot.speed !== 1 && <> · {snapshot.speed}×</>}
              </span>
            </div>
            <div className="hero-actions">
              <button className="btn btn-primary" onClick={() => void togglePlay()}>
                {snapshot.state === "playing" ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
                {snapshot.state === "playing" ? t("player").pause : t("player").play}
              </button>
              <button className="btn" onClick={() => void previous()}>
                <PreviousIcon size={18} />
              </button>
              <button className="btn" onClick={() => void next()}>
                <NextIcon size={18} />
              </button>
              <button
                className={`btn ${liked ? "liked" : ""}`}
                onClick={() => void toggleLike()}
                title={t("common").like}
              >
                <HeartIcon size={18} filled={liked} />
              </button>
              <button
                className={`btn ${lyricsOpen ? "active" : ""}`}
                onClick={toggleLyrics}
                title={t("player").lyrics}
              >
                <LyricsIcon size={18} />
                {t("player").lyrics}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="np-empty">
          <div className="np-empty-cover">W</div>
          <span className="hero-label">{t("app").nowPlaying}</span>
          <h1>{t("home").nothingPlaying}</h1>
          <p className="hero-artist">{t("home").pickTrackHint}</p>
          <div className="hero-actions">
            <button className="btn btn-primary" onClick={() => onNavigate("search")}>
              <SearchIcon size={18} /> {t("nav").search}
            </button>
            <button className="btn" onClick={() => void startWave()}>
              <WaveIcon size={18} /> {t("nav").wave}
            </button>
            <button className="btn" onClick={() => void openLocalDirectory()}>
              {t("nav").localFiles}
            </button>
          </div>
        </div>
      )}

      {lyricsOpen && track && (
        <div className="lyrics">
          <div className="lyrics-header">
            <span>{t("player").lyrics}</span>
            {lyrics?.source && <span className="lyrics-source">{tf("home").lyricsSource(lyrics.source)}</span>}
            {lyrics && lyrics.lines.length === 0 && (
              <button
                className="btn secondary lyrics-retry"
                onClick={() => void reloadLyrics()}
                disabled={lyricsLoading}
              >
                {t("home").lyricsRetry}
              </button>
            )}
          </div>
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
                  onClick={() => handleLineClick(line)}
                  style={i === activeIndex && lyrics.synced ? { "--progress": lineProgress } as React.CSSProperties : undefined}
                >
                  {line.text || "\u00A0"}
                </p>
              ))
            ) : (
              <p className="lyrics-hint">{t("home").lyricsNotFound}</p>
            )}
          </div>
        </div>
      )}

      <div className="quick-actions">
        <button className="card-action" onClick={() => void openLocalDirectory()}>
          <span>{t("home").localFiles}</span>
          <small>{t("home").localFilesDesc}</small>
        </button>
        <button className="card-action" onClick={() => void startWave()}>
          <span>{t("home").wave}</span>
          <small>{t("home").waveDesc}</small>
        </button>
        <button
          className={`card-action ${radioActive ? "active" : ""}`}
          onClick={() => void startRadio()}
          disabled={!track}
          title={track ? undefined : t("home").radioNoTrack}
        >
          <span>{t("home").radio}</span>
          <small>{track ? t("home").radioDesc : t("home").radioNoTrack}</small>
        </button>
      </div>
    </div>
  );
}
