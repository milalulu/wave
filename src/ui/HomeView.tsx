import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import type { ViewKey } from "./Sidebar";
import { useApp } from "../app/stores";
import { useI18n } from "./I18nContext";
import { Cover } from "./Cover";
import { TrackRow } from "./TrackRow";
import type { HistoryEntry } from "../core/types";
import {
  DownloadIcon,
  FolderIcon,
  HeartIcon,
  HomeIcon,
  ListIcon,
  PauseIcon,
  PlayIcon,
  PlaylistIcon,
  RadioIcon,
  SearchIcon,
  SettingsIcon,
  WaveIcon,
} from "./icons";

interface HomeViewProps {
  onNavigate: (view: ViewKey) => void;
}

export function HomeView({ onNavigate }: HomeViewProps) {
  const { t } = useI18n();
  const snapshot = useApp((s) => s.snapshot);
  const likedIds = useApp((s) => s.likedIds);
  const playlists = useApp((s) => s.playlists);
  const localTracks = useApp((s) => s.localTracks);
  const history = useApp((s) => s.services?.history);
  const loadPlaylists = useApp((s) => s.loadPlaylists);
  const togglePlay = useApp((s) => s.togglePlay);
  const openLocalDirectory = useApp((s) => s.openLocalDirectory);
  const startRadio = useApp((s) => s.startRadio);
  const [recent, setRecent] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    void loadPlaylists();
  }, [loadPlaylists]);

  useEffect(() => {
    let cancelled = false;
    if (!history) return;
    void history.getHistory(6).then((entries) => {
      if (!cancelled) setRecent(entries);
    });
    return () => {
      cancelled = true;
    };
  }, [history]);

  const track = snapshot.current;

  const cards: { view: ViewKey; icon: (p: { size?: number }) => ReactElement; label: string; desc: string }[] = [
    { view: "search", icon: SearchIcon, label: t("nav").search, desc: t("home").searchDesc },
    { view: "library", icon: ListIcon, label: t("nav").library, desc: t("home").libraryDesc },
    { view: "wave", icon: WaveIcon, label: t("nav").wave, desc: t("home").waveDesc },
    { view: "playlist", icon: PlaylistIcon, label: t("nav").playlist, desc: t("home").playlistsDesc },
    { view: "downloads", icon: DownloadIcon, label: t("nav").downloads, desc: t("home").downloadsDesc },
    { view: "settings", icon: SettingsIcon, label: t("nav").settings, desc: t("home").settingsDesc },
  ];

  return (
    <div className="view home-main">
      <header className="home-hero">
        <div>
          <span className="hero-label">{t("app").name}</span>
          <h1>{t("app").welcome}</h1>
          <p className="home-sub">{t("home").welcomeSubtitle}</p>
        </div>
        <div className="home-stats">
          {likedIds.length > 0 && (
            <span className="home-stat">
              <HeartIcon size={14} filled />
              {t("library").liked}: {likedIds.length}
            </span>
          )}
          {localTracks.length > 0 && (
            <span className="home-stat">
              <FolderIcon size={14} />
              {t("library").local}: {localTracks.length}
            </span>
          )}
          {playlists.length > 0 && (
            <span className="home-stat">
              <PlaylistIcon size={14} />
              {t("nav").playlist}: {playlists.length}
            </span>
          )}
        </div>
      </header>

      {recent.length > 0 && (
        <section>
          <h2 className="home-section-title">{t("home").recentlyPlayed}</h2>
          <div className="track-list">
            {recent.map((entry, i) => (
              <TrackRow
                key={`${entry.track.id}:${entry.playedAt}`}
                track={entry.track}
                index={i + 1}
                nowPlaying={recent.findIndex((e) => e.track.id === snapshot.current?.id) === i}
              />
            ))}
          </div>
        </section>
      )}

      {track && (
        <section className="home-now">
          <div className="home-now-cover">
            {track.coverUrl ? (
              <Cover src={track.coverUrl} alt="" />
            ) : (
              <div className="home-now-empty">{track.title?.charAt(0) ?? "W"}</div>
            )}
          </div>
          <div className="home-now-info">
            <span className="home-now-label">{t("app").nowPlaying}</span>
            <h2>{track.title}</h2>
            <p>{track.artist}</p>
          </div>
          <div className="home-now-actions">
            <button className="btn btn-primary" onClick={() => void togglePlay()}>
              {snapshot.state === "playing" ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
              {snapshot.state === "playing" ? t("player").pause : t("player").play}
            </button>
            <button className="btn" onClick={() => onNavigate("nowPlaying")}>
              {t("app").nowPlaying}
            </button>
          </div>
        </section>
      )}

      <h2 className="home-section-title">{t("home").browse}</h2>
      <div className="quick-actions">
        {cards.map((c) => (
          <button key={c.view} className="card-action" onClick={() => onNavigate(c.view)}>
            <span className="card-action-icon">
              <c.icon size={20} />
            </span>
            <span>{c.label}</span>
            <small>{c.desc}</small>
          </button>
        ))}
        <button className="card-action" onClick={() => void openLocalDirectory()}>
          <span className="card-action-icon">
            <FolderIcon size={20} />
          </span>
          <span>{t("nav").localFiles}</span>
          <small>{t("home").localFilesDesc}</small>
        </button>
        <button
          className={`card-action ${!track ? "card-action-disabled" : ""}`}
          onClick={() => void startRadio()}
          disabled={!track}
          title={track ? undefined : t("home").radioNoTrack}
        >
          <span className="card-action-icon">
            <RadioIcon size={20} />
          </span>
          <span>{t("home").radio}</span>
          <small>{track ? t("home").radioDesc : t("home").radioNoTrack}</small>
        </button>
      </div>

      <span className="home-brand">
        <HomeIcon size={14} /> Wave
      </span>
    </div>
  );
}
