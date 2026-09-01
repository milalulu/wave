import { useApp } from "../app/stores";
import { useI18n } from "./I18nContext";
import { Cover } from "./Cover";
import { ProgressBar } from "./ProgressBar";
import {
  BackIcon,
  HeartIcon,
  HomeIcon,
  ListIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  SearchIcon,
  SettingsIcon,
  SpinnerIcon,
  WaveIcon,
} from "./icons";
import type { ViewKey } from "./Sidebar";

export const TAB_KEYS: ViewKey[] = ["home", "search", "wave", "library", "settings"];

export function isTabView(view: ViewKey): boolean {
  return (TAB_KEYS as string[]).includes(view);
}

export function parentTab(view: ViewKey): ViewKey | null {
  switch (view) {
    case "album":
    case "artist":
    case "playlist":
    case "queue":
    case "downloads":
      return "library";
    default:
      return null;
  }
}

interface MobileTopBarProps {
  view: ViewKey;
  canGoBack: boolean;
  onBack: () => void;
}

export function MobileTopBar({ view, canGoBack, onBack }: MobileTopBarProps) {
  const { t } = useI18n();
  const albumTitle = useApp((s) => s.albumDetail?.album.title);
  const artistName = useApp((s) => s.artistDetail?.artist.name);
  const playlistName = useApp((s) =>
    s.playlists.find((p) => p.id === s.selectedPlaylistId)?.name,
  );

  const title = (() => {
    switch (view) {
      case "album":
        return albumTitle ?? t("nav").library;
      case "artist":
        return artistName ?? t("nav").library;
      case "playlist":
        return playlistName ?? t("nav").playlist;
      case "queue":
        return t("nav").queue;
      case "downloads":
        return t("nav").downloads;
      case "nowPlaying":
        return t("nav").nowPlaying;
      case "home":
        return t("nav").home;
      case "search":
        return t("nav").search;
      case "wave":
        return t("nav").wave;
      case "library":
        return t("nav").library;
      case "settings":
        return t("nav").settings;
    }
  })();

  return (
    <header className="mobile-topbar">
      {canGoBack && (
        <button className="icon-btn" onClick={onBack}>
          <BackIcon size={22} />
        </button>
      )}
      <h1 className="mobile-topbar-title">{title}</h1>
    </header>
  );
}

interface BottomNavProps {
  view: ViewKey;
  onView: (view: ViewKey) => void;
}

export function BottomNav({ view, onView }: BottomNavProps) {
  const { t } = useI18n();
  const active = parentTab(view) ?? (isTabView(view) ? view : null);

  const items = [
    { key: "home" as const, label: t("nav").home, icon: HomeIcon },
    { key: "search" as const, label: t("nav").search, icon: SearchIcon },
    { key: "wave" as const, label: t("nav").wave, icon: WaveIcon },
    { key: "library" as const, label: t("nav").library, icon: ListIcon },
    { key: "settings" as const, label: t("nav").settings, icon: SettingsIcon },
  ];

  return (
    <nav className="bottom-nav">
      {items.map((item) => (
        <button
          key={item.key}
          className={`bottom-nav-item ${active === item.key ? "active" : ""}`}
          onClick={() => onView(item.key)}
        >
          <item.icon size={22} />
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

interface MobilePlayerBarProps {
  onOpenPlayer: () => void;
  onOpenQueue: () => void;
}

export function MobilePlayerBar({ onOpenPlayer, onOpenQueue }: MobilePlayerBarProps) {
  const { t } = useI18n();
  const snapshot = useApp((s) => s.snapshot);
  const likedIds = useApp((s) => s.likedIds);
  const togglePlay = useApp((s) => s.togglePlay);
  const next = useApp((s) => s.next);
  const toggleLike = useApp((s) => s.toggleLike);

  const track = snapshot.current;
  const liked = track ? likedIds.has(track.id) : false;
  const buffering = snapshot.state === "loading";

  return (
    <div className="mini-player">
      <button
        className="mini-player-main"
        onClick={onOpenPlayer}
        disabled={!track}
        aria-label={t("nav").nowPlaying}
      >
        {track?.coverUrl ? (
          <Cover className="mini-cover" src={track.coverUrl} alt="" />
        ) : (
          <div className="mini-cover mini-cover-empty" />
        )}
        <span className="mini-info">
          <span className="mini-title">{track?.title ?? t("common").unknown}</span>
          <span className="mini-artist">{track?.artist ?? ""}</span>
        </span>
        <ProgressBar duration={track?.duration} />
      </button>
      <button
        className={`mini-btn ${liked ? "liked" : ""}`}
        disabled={!track}
        onClick={() => void toggleLike()}
        aria-label={liked ? t("common").unlike : t("common").like}
      >
        <HeartIcon size={20} filled={liked} />
      </button>
      <button
        className="mini-btn"
        disabled={!track}
        onClick={() => void togglePlay()}
        aria-label={snapshot.state === "playing" ? t("player").pause : t("player").play}
      >
        {buffering ? (
          <SpinnerIcon size={22} />
        ) : snapshot.state === "playing" ? (
          <PauseIcon size={24} />
        ) : (
          <PlayIcon size={24} />
        )}
      </button>
      <button
        className="mini-btn"
        disabled={!track}
        onClick={() => void next()}
        aria-label={t("player").next}
      >
        <NextIcon size={22} />
      </button>
      <button className="mini-btn mini-queue" onClick={onOpenQueue} aria-label={t("nav").queue}>
        <ListIcon size={22} />
      </button>
    </div>
  );
}
