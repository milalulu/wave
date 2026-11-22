import { trackCover } from "../core/cover/trackCover";
import { PlaybackControls } from "./PlaybackControls";
import { playbackSource } from "../core/types";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ViewKey } from "./Sidebar";
import { useApp } from "../app/stores";
import { useI18n } from "./I18nContext";
import { Cover } from "./Cover";
import { providerLabel } from "./providers";
import { isStreamingProvider } from "../app/platformSettings";
import { useSwipeDown } from "./gestures";
import { SleepControl } from "./SleepControl";
import { tileStyle } from "./tileHue";
import { HeartIcon, ChevronDownIcon, LyricsIcon, SearchIcon, WaveIcon, ChartIcon, VolumeIcon, VolumeMuteIcon, QueueIcon, FullscreenIcon, FullscreenExitIcon } from "./icons";

import { Spectrum } from "./Spectrum";
import { extractDominantColor, preloadDominantColor } from "./extractColor";
import { SeekBar } from "./SeekBar";
import { VolumeSlider } from "./VolumeSlider";
import { LyricsBody } from "./LyricsBody";
import { ElapsedTime } from "./ElapsedTime";
import { QueueView } from "./QueueView";

interface NowPlayingViewProps {
  onNavigate: (view: ViewKey) => void;
  lyricsRequest?: number;
}

export function NowPlayingView({ onNavigate, lyricsRequest }: NowPlayingViewProps) {
  const lyricsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!lyricsRequest) return;
    const frame = requestAnimationFrame(() => {
      lyricsRef.current?.scrollIntoView({ block: "start" });
      lyricsRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [lyricsRequest]);
  const { t, tf, locale } = useI18n();
  const lyricsFile = useRef<HTMLInputElement>(null);
  const swipeDownRef = useSwipeDown<HTMLDivElement>(() => onNavigate("home"));
  const snapshot = useApp((s) => s.snapshot);
  const likedIds = useApp((s) => s.likedIds);
  const lyrics = useApp((s) => s.lyrics);
  const lyricsLoading = useApp((s) => s.lyricsLoading);
  const lyricsOpen = useApp((s) => s.lyricsOpen);
  const lyricsAutoscroll = useApp((s) => s.lyricsAutoscroll);
  const toggleLike = useApp((s) => s.toggleLike);
  const toggleLyrics = useApp((s) => s.toggleLyrics);
  const reloadLyrics = useApp((s) => s.reloadLyrics);
  const openLocalDirectory = useApp((s) => s.openLocalDirectory);
  const startWave = useApp((s) => s.startWave);
  const startRadio = useApp((s) => s.startRadio);
  const radioActive = useApp((s) => s.radioActive);
  const services = useApp((s) => s.services);
  const loadAlbum = useApp((s) => s.loadAlbum);
  const setView = useApp((s) => s.setView);
  const setVolume = useApp((s) => s.setVolume);
  const [spectrumOpen, setSpectrumOpen] = useState(false);
  const [wide, setWide] = useState(() => window.matchMedia("(min-width: 1200px)").matches);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 1200px)");
    const update = () => setWide(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      void document.exitFullscreen();
    }
  };

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

  return (
    <div className="home np-dynamic-bg echoes-stage" ref={swipeDownRef} style={npStyle}>
      <div className="echoes-wordmark" aria-hidden="true">wave</div>
      <div className="echoes-layout">
      <div className="echoes-main">
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
            {trackCover(track) ? (
              <Cover src={trackCover(track)} alt="" />
            ) : (
              <div className="hero-cover-empty" style={tileStyle(track.title)}>{track.title?.charAt(0) ?? "W"}</div>
            )}
          </div>
          <div className="hero-info">
            <span className="hero-label">{t("app").nowPlaying}</span>
            <h1 title={track.title}>{track.title}</h1>
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
              {isStreamingProvider(playbackSource(track).provider) && <span className="hero-meta-item">
                <span className={`provider-badge provider-${playbackSource(track).provider}`}>
                  {providerLabel(playbackSource(track).provider)}
                </span>
              </span>}
            </div>
            <div className="hero-meta">
              <ElapsedTime speed={snapshot.speed} />
            </div>
            <div className="hero-actions">
              <PlaybackControls onPickTrack={() => onNavigate("search")} />
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
              <button
                className="btn"
                onClick={toggleFullscreen}
                title={isFullscreen ? t("player").exitFullscreen : t("player").fullscreen}
              >
                {isFullscreen ? <FullscreenExitIcon size={18} /> : <FullscreenIcon size={18} />}
              </button>
            </div>
            <SeekBar track={track} className="np-seek" />
            <div className="np-extras">
              <button className="icon-btn" onClick={() => onNavigate("queue" as ViewKey)} title={t("nav").queue}>
                <QueueIcon size={16} />
              </button>
              <SleepControl />
              <div className="np-volume">
                <button
                  className="icon-btn"
                  onClick={() => setVolume(snapshot.volume === 0 ? 100 : 0)}
                  title={snapshot.volume === 0 ? t("player").mute : t("player").volume}
                >
                  {snapshot.volume === 0 ? <VolumeMuteIcon size={16} /> : <VolumeIcon size={16} />}
                </button>
                <VolumeSlider
                  value={Math.round(snapshot.volume * 100)}
                  label={t("player").volume}
                  onChange={setVolume}
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
        <div className="lyrics" ref={lyricsRef} tabIndex={-1} aria-label={t("player").lyrics}>
          <div className="lyrics-header">
            <span>{t("player").lyrics}</span>
            {lyrics?.source && lyrics.source !== "none" && <span className="lyrics-source">
              {lyrics.source === "local" ? (locale === "ru" ? "Из файла" : "From file") : tf("home").lyricsSource(lyrics.source)}
            </span>}
            <button className="btn secondary lyrics-retry" onClick={() => lyricsFile.current?.click()}>
              {locale === "ru" ? "Загрузить текст" : "Import lyrics"}
            </button>
            <input ref={lyricsFile} type="file" hidden accept=".lrc,.txt" onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              const services = useApp.getState().services;
              if (!file || !services) return;
              void (async () => {
                if (file.size > 128 * 1024) throw new Error("Lyrics file is too large");
                services.lyrics.importLocalLyrics(track, await file.text());
                const app = useApp.getState();
                if (app.services === services && app.snapshot.current?.id === track.id) await app.loadLyrics(track);
              })().catch(() => useApp.getState().notify(locale === "ru"
                ? "Не удалось загрузить текст. Выбери непустой файл LRC или TXT до 128 КБ."
                : "Could not import lyrics. Choose a non-empty LRC or TXT file up to 128 KB."));
            }} />
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
          <div>
            <LyricsBody lyrics={lyrics} lyricsLoading={lyricsLoading} lyricsAutoscroll={lyricsAutoscroll} />
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
      {wide && (
        <aside className="echoes-queue content" aria-label={t("nav").queue}>
          <QueueView />
        </aside>
      )}
      </div>
    </div>
  );
}
