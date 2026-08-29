import { useEffect, useMemo, useRef, useState } from "react";
import type { ViewKey } from "./Sidebar";
import { useApp } from "../app/stores";
import { useI18n } from "./I18nContext";
import { Cover } from "./Cover";
import { providerLabel } from "./providers";
import { useSwipeDown } from "./gestures";
import { HeartIcon, ChevronDownIcon, LyricsIcon, NextIcon, PauseIcon, PlayIcon, PreviousIcon, SearchIcon, WaveIcon, ChartIcon, ShuffleIcon, RepeatIcon, VolumeIcon, VolumeMuteIcon, QueueIcon, SpinnerIcon } from "./icons";
import { formatTime } from "../core/util/format";
import { Spectrum } from "./Spectrum";
import { extractDominantColor, preloadDominantColor } from "./extractColor";

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
  const services = useApp((s) => s.services);
  const loadAlbum = useApp((s) => s.loadAlbum);
  const setView = useApp((s) => s.setView);
  const setVolume = useApp((s) => s.setVolume);
  const toggleShuffle = useApp((s) => s.toggleShuffle);
  const cycleRepeat = useApp((s) => s.cycleRepeat);
  const [spectrumOpen, setSpectrumOpen] = useState(false);

  const track = snapshot.current;
  const liked = track ? likedIds.has(track.id) : false;

  const [domColor, setDomColor] = useState<string | null>(null);
  useEffect(() => {
    if (!track?.coverUrl) { setDomColor(null); return; }
    const cached = extractDominantColor(track.coverUrl);
    if (cached) { setDomColor(cached); return; }
    preloadDominantColor(track.coverUrl);
    setDomColor(null);
    let frame: number;
    const poll = () => {
      const c = extractDominantColor(track.coverUrl!);
      if (c) { setDomColor(c); return; }
      frame = requestAnimationFrame(poll);
    };
    frame = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(frame);
  }, [track?.coverUrl]);

  const npStyle = useMemo(() => {
    if (!domColor) return undefined;
    return {
      "--np-dominant": domColor,
      "--np-bg-dynamic": `radial-gradient(ellipse at 30% 0%, ${domColor}33 0%, transparent 60%)`,
    } as React.CSSProperties;
  }, [domColor]);

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
    <div className="home np-dynamic-bg" ref={swipeDownRef} style={npStyle}>
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
              {track.album && track.meta?.albumId != null && (
                <span className="hero-meta-item hero-album-link" onClick={() => { loadAlbum(track.provider, String(track.meta!.albumId)); setView("album"); }}>
                  {t("home").album}: <b>{track.album}</b>
                </span>
              )}
              {track.album && !track.meta?.albumId && (
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
              <button className="btn btn-primary" onClick={() => void togglePlay()} disabled={snapshot.state === "loading"}>
                {snapshot.state === "loading" ? (
                  <SpinnerIcon size={18} />
                ) : snapshot.state === "playing" ? (
                  <PauseIcon size={18} />
                ) : (
                  <PlayIcon size={18} />
                )}
                {snapshot.state === "loading" ? t("common").loading : snapshot.state === "playing" ? t("player").pause : t("player").play}
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
              <button
                className={`btn ${spectrumOpen ? "active" : ""}`}
                onClick={() => setSpectrumOpen((o) => !o)}
                title={t("player").spectrum}
              >
                <ChartIcon size={18} />
              </button>
            </div>
            <div className="np-seek">
              <span className="time">{formatTime(position)}</span>
              <input
                type="range"
                className="seek"
                min={0}
                max={duration || 100}
                step={1}
                value={Math.min(position, duration || 0)}
                aria-label={t("player").seek}
                onChange={(e) => seek(Number(e.target.value))}
                onInput={(e) => seek(Number((e.target as HTMLInputElement).value))}
              />
              <span className="time">{formatTime(duration)}</span>
            </div>
            <div className="np-extras">
              <button
                className={`icon-btn ${snapshot.shuffle ? "active" : ""}`}
                onClick={toggleShuffle}
                title={t("player").shuffle}
              >
                <ShuffleIcon size={16} />
              </button>
              <button
                className={`icon-btn ${snapshot.repeat !== "off" ? "active" : ""}`}
                onClick={cycleRepeat}
                title={snapshot.repeat === "one" ? t("player").repeatOne : t("player").repeat}
              >
                <RepeatIcon size={16} />
              </button>
              <button className="icon-btn" onClick={() => onNavigate("queue" as ViewKey)} title={t("nav").queue}>
                <QueueIcon size={16} />
              </button>
              <div className="np-volume">
                <button
                  className="icon-btn"
                  onClick={() => setVolume(snapshot.volume === 0 ? 100 : 0)}
                  title={snapshot.volume === 0 ? t("player").mute : t("player").volume}
                >
                  {snapshot.volume === 0 ? <VolumeMuteIcon size={16} /> : <VolumeIcon size={16} />}
                </button>
                <input
                  type="range"
                  className="volume"
                  min={0}
                  max={100}
                  value={Math.round(snapshot.volume * 100)}
                  aria-label="Volume"
                  onChange={(e) => setVolume(Number(e.target.value))}
                  onInput={(e) => setVolume(Number((e.target as HTMLInputElement).value))}
                />
              </div>
            </div>
            {spectrumOpen && services?.engine && (
              <div className="np-spectrum">
                <Spectrum engine={services.engine} />
              </div>
            )}
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
