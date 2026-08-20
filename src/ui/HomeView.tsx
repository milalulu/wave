import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import type { ViewKey } from "./Sidebar";
import { useApp } from "../app/stores";
import { useI18n } from "./I18nContext";
import { Cover } from "./Cover";
import { TrackRow } from "./TrackRow";
import { WaveLogoMark, WaveTitle } from "./icons";
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

function useIsMobile() {
  const [mobile, setMobile] = useState(() => window.innerWidth <= 720);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 720px)");
    const fn = (e: MediaQueryListEvent) => setMobile(e.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);
  return mobile;
}

export function HomeView({ onNavigate }: HomeViewProps) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
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
    void history.getHistory(isMobile ? 12 : 6).then((entries) => {
      if (!cancelled) setRecent(entries);
    });
    return () => {
      cancelled = true;
    };
  }, [history, isMobile]);

  const track = snapshot.current;

  const cards: { view: ViewKey; icon: (p: { size?: number }) => ReactElement; label: string; desc: string }[] = [
    { view: "search", icon: SearchIcon, label: t("nav").search, desc: t("home").searchDesc },
    { view: "library", icon: ListIcon, label: t("nav").library, desc: t("home").libraryDesc },
    { view: "wave", icon: WaveIcon, label: t("nav").wave, desc: t("home").waveDesc },
    { view: "playlist", icon: PlaylistIcon, label: t("nav").playlist, desc: t("home").playlistsDesc },
    { view: "downloads", icon: DownloadIcon, label: t("nav").downloads, desc: t("home").downloadsDesc },
    { view: "settings", icon: SettingsIcon, label: t("nav").settings, desc: t("home").settingsDesc },
  ];

  if (isMobile) {
    return (
      <div className="view mobile-home">
        {track ? (
          <div className="mh-now-hero" onClick={() => onNavigate("nowPlaying")}>
            <div className="mh-now-cover">
              {track.coverUrl ? (
                <Cover src={track.coverUrl} alt="" />
              ) : (
                <div className="mh-now-cover-empty">{track.title?.charAt(0) ?? "W"}</div>
              )}
            </div>
            <div className="mh-now-info">
              <span className="mh-now-label">{t("app").nowPlaying}</span>
              <h2 className="mh-now-title">{track.title}</h2>
              <p className="mh-now-artist">{track.artist}</p>
            </div>
            <button
              className="mh-now-play"
              onClick={(e) => { e.stopPropagation(); void togglePlay(); }}
              aria-label={snapshot.state === "playing" ? t("player").pause : t("player").play}
            >
              {snapshot.state === "playing" ? <PauseIcon size={28} /> : <PlayIcon size={28} />}
            </button>
          </div>
        ) : (
          <div className="mh-empty-hero">
            <div className="mh-empty-icon"><WaveIcon size={40} /></div>
            <h1>{t("app").welcome}</h1>
            <p>{t("home").welcomeSubtitle}</p>
          </div>
        )}

        {recent.length > 0 && (
          <section className="mh-section">
            <h2 className="mh-section-title">{t("home").recentlyPlayed}</h2>
            <div className="mh-recent-scroll">
              {recent.map((entry) => (
                <button
                  key={`${entry.track.id}:${entry.playedAt}`}
                  className="mh-recent-card"
                  onClick={() => onNavigate("nowPlaying")}
                >
                  <div className="mh-recent-cover">
                    {entry.track.coverUrl ? (
                      <Cover src={entry.track.coverUrl} alt="" />
                    ) : (
                      <div className="mh-recent-cover-empty">{entry.track.title?.charAt(0) ?? "?"}</div>
                    )}
                  </div>
                  <span className="mh-recent-title">{entry.track.title}</span>
                  <span className="mh-recent-artist">{entry.track.artist}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="mh-section">
          <div className="mh-actions-grid">
            <button className="mh-action-card" onClick={() => onNavigate("search")}>
              <span className="mh-action-icon"><SearchIcon size={24} /></span>
              <span className="mh-action-label">{t("nav").search}</span>
            </button>
            <button className="mh-action-card" onClick={() => onNavigate("library")}>
              <span className="mh-action-icon"><ListIcon size={24} /></span>
              <span className="mh-action-label">{t("nav").library}</span>
            </button>
            <button className="mh-action-card" onClick={() => onNavigate("wave")}>
              <span className="mh-action-icon"><WaveIcon size={24} /></span>
              <span className="mh-action-label">{t("nav").wave}</span>
            </button>
            <button
              className={`mh-action-card ${!track ? "mh-action-disabled" : ""}`}
              onClick={() => void startRadio()}
              disabled={!track}
            >
              <span className="mh-action-icon"><RadioIcon size={24} /></span>
              <span className="mh-action-label">{t("home").radio}</span>
            </button>
            <button className="mh-action-card" onClick={() => onNavigate("playlist")}>
              <span className="mh-action-icon"><PlaylistIcon size={24} /></span>
              <span className="mh-action-label">{t("nav").playlist}</span>
            </button>
            <button className="mh-action-card" onClick={() => void openLocalDirectory()}>
              <span className="mh-action-icon"><FolderIcon size={24} /></span>
              <span className="mh-action-label">{t("nav").localFiles}</span>
            </button>
          </div>
        </section>

        {(likedIds.size > 0 || playlists.length > 0 || localTracks.length > 0) && (
          <section className="mh-section">
            <div className="mh-stats-row">
              {likedIds.size > 0 && (
                <button className="mh-stat-chip" onClick={() => onNavigate("library")}>
                  <HeartIcon size={14} filled /> {likedIds.size} {t("library").liked}
                </button>
              )}
              {playlists.length > 0 && (
                <button className="mh-stat-chip" onClick={() => onNavigate("playlist")}>
                  <PlaylistIcon size={14} /> {playlists.length} {t("nav").playlist}
                </button>
              )}
              {localTracks.length > 0 && (
                <button className="mh-stat-chip" onClick={() => void openLocalDirectory()}>
                  <FolderIcon size={14} /> {localTracks.length} {t("nav").localFiles}
                </button>
              )}
            </div>
          </section>
        )}
      </div>
    );
  }

  return (
    <div className="view home-main">
      {/* Immersive Hero Banner matching the brand asset sheet */}
      <header className="home-hero-banner">
        <div className="home-hero-content">
          <div className="home-hero-badge">
            <WaveTitle height={120} />
          </div>
          <h1>Музыка. Без границ.</h1>
          <p className="home-sub">Современный музыкальный плеер с интеллектуальной волной, кросс-провайдерным поиском и идеальным звуком.</p>
          <div className="home-hero-actions">
            <button className="btn btn-hero-play" onClick={() => onNavigate("wave")}>
              <WaveLogoMark size={18} style={{ filter: "brightness(0) invert(1)" }} />
              Слушать волну
            </button>
            <button className="btn btn-hero-secondary" onClick={() => onNavigate("search")}>
              <SearchIcon size={18} />
              Найти трек
            </button>
          </div>
        </div>
      </header>

      {recent.length > 0 && (
        <section>
          <h2 className="home-section-title">{t("home").recentlyPlayed}</h2>
          <div className="track-list">
            {(() => {
              const currentId = snapshot.current?.id;
              return recent.map((entry, i) => (
                <TrackRow
                  key={`${entry.track.id}:${entry.playedAt}`}
                  track={entry.track}
                  index={i + 1}
                  nowPlaying={currentId != null && entry.track.id === currentId}
                />
              ));
            })()}
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
