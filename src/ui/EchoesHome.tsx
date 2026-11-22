import { trackCover } from "../core/cover/trackCover";
import { useApp } from "../app/stores";
import { useState } from "react";
import { IconButton } from "./primitives/IconButton";
import { useI18n } from "./I18nContext";
import type { ViewKey } from "./Sidebar";
import { Cover } from "./Cover";
import { QueueView } from "./QueueView";
import { SeekBar } from "./SeekBar";
import { WaveformVisualizer } from "./WaveformVisualizer";
import { PlaybackControls } from "./PlaybackControls";
import { HeartIcon, SearchIcon, ChartIcon, PlayIcon, PauseIcon, ListIcon, LyricsIcon, SpinnerIcon } from "./icons";

export function EchoesHome({ onNavigate }: { onNavigate: (view: ViewKey) => void }) {
  const { t } = useI18n();
  const [queueOpen, setQueueOpen] = useState(true);
  const toggleQueue = () => {
    if (window.matchMedia("(max-width: 720px), (max-width: 1000px) and (max-height: 600px) and (pointer: coarse)").matches) onNavigate("queue");
    else setQueueOpen((open) => !open);
  };
  const toggleLyrics = useApp((s) => s.toggleLyrics);
  const lyricsOpen = useApp((s) => s.lyricsOpen);
  const snapshot = useApp((s) => s.snapshot);
  const services = useApp((s) => s.services);
  const togglePlay = useApp((s) => s.togglePlay);
  const toggleLike = useApp((s) => s.toggleLike);
  const likedIds = useApp((s) => s.likedIds);
  const play = useApp((s) => s.play);
  const current = snapshot.current;
  const liked = current ? likedIds.has(current.id) : false;
  const playing = snapshot.state === "playing";
  const tiles = snapshot.queue.slice(0, 5);
  return (
    <div className={`echoes-home ${queueOpen ? "" : "echoes-queue-closed"}`}>
      <div className="echoes-home-art" aria-hidden="true"><span className="echoes-title">wave</span></div>
      <header className="echoes-header">
        <div className="echoes-header-actions">
          <IconButton onClick={() => onNavigate("search")} label={t("nav").search}><SearchIcon size={25} /></IconButton>
          <IconButton active={queueOpen} aria-expanded={queueOpen} onClick={toggleQueue} label={t("nav").queue}><ListIcon size={25} /></IconButton>
          <button className="echoes-avatar" onClick={() => onNavigate("library")} aria-label={t("nav").library} />
        </div>
      </header>
      <div className="echoes-body">
        <section className="echoes-feature" aria-label={t("app").nowPlaying}>
          <div className="echoes-album">
            {current ? <Cover key={current.id} src={trackCover(current)} alt={current.title} priority /> : <div className="echoes-liquid" aria-hidden="true" />}
            <button className="echoes-cover-play" disabled={snapshot.state === "loading"} aria-busy={snapshot.state === "loading"} onClick={() => current ? void togglePlay() : onNavigate("search")} aria-label={snapshot.state === "loading" ? t("common").loading : playing ? t("player").pause : t("player").play}>
              {snapshot.state === "loading" ? <SpinnerIcon size={28} /> : playing ? <PauseIcon size={28} /> : <PlayIcon size={28} />}
            </button>
          </div>
          <div className="echoes-song">
            <div className="echoes-song-top">
              <WaveformVisualizer engine={current ? services?.engine : undefined} label={current ? t("player").spectrum : "Wave"} />
              <button className={`icon-btn ${liked ? "liked" : ""}`} disabled={!current} onClick={() => void toggleLike()} aria-label={t("common").like}><HeartIcon size={26} filled={liked} /></button>
            </div>
            <h1 title={current?.title}>{current?.title ?? "Wave"}</h1>
            <p title={current?.artist} className={current ? undefined : "echoes-empty-hint"}>{current?.artist ?? t("home").pickTrackHint}</p>
            <PlaybackControls onPickTrack={() => onNavigate("search")} />
            <div className="echoes-mobile-seek"><SeekBar track={current} /></div>
          </div>
          <div className="echoes-shelf">
            {tiles.length ? tiles.map((track, i) => <button key={`${track.id}:${i}`} className="echoes-tile" onClick={() => void play(snapshot.queue, i)} aria-label={`${t("player").play}: ${track.title}`}><Cover src={trackCover(track)} alt="" /><span>{track.title}</span><PlayIcon size={18} /></button>) : ["search", "library", "wave", "downloads"].map((view, i) => <button key={view} className={`echoes-tile echoes-tile-${i}`} onClick={() => onNavigate(view as ViewKey)}><div className="echoes-liquid" aria-hidden="true" /><span>{t("nav")[view as "search" | "library" | "wave" | "downloads"]}</span><PlayIcon size={18} /></button>)}
          </div>
        </section>
        {queueOpen && <aside className="echoes-dock" aria-label={t("nav").queue}>
          <div className="echoes-dock-tabs">
            <IconButton active onClick={toggleQueue} label={t("nav").queue}><ListIcon size={24} /></IconButton>
            <IconButton onClick={() => { if (!lyricsOpen) toggleLyrics(); onNavigate("nowPlaying"); }} label={t("player").lyrics}><LyricsIcon size={24} /></IconButton>
            <button className="icon-btn" onClick={() => onNavigate("settings")} aria-label={t("player").equalizer}><ChartIcon size={24} /></button>
          </div>
          <div className="echoes-dock-scroll content"><QueueView compact /></div>
        </aside>}
      </div>
    </div>
  );
}
