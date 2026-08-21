import type { ReactElement } from "react";
import { useApp } from "../app/stores";
import { useI18n } from "./I18nContext";
import { FolderIcon, HomeIcon, ListIcon, SearchIcon, PlaylistIcon, SettingsIcon, DownloadIcon, PlayIcon, WaveLogoMark, WaveIcon } from "./icons";

export type ViewKey = "home" | "nowPlaying" | "search" | "library" | "queue" | "wave" | "album" | "artist" | "playlist" | "settings" | "downloads";

function QueueIcon2(p: { size?: number }) {
  return (
    <svg
      width={p.size ?? 18}
      height={p.size ?? 18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
    >
      <path d="M4 6h16M4 12h10M4 18h7" />
      <path d="M16 16l3 2 3-4" />
    </svg>
  );
}

interface SidebarProps {
  view: ViewKey;
  onView: (view: ViewKey) => void;
}

export function Sidebar({ view, onView }: SidebarProps) {
  const { t } = useI18n();
  const openLocalDirectory = useApp((s) => s.openLocalDirectory);
  const downloads = useApp((s) => s.downloads);
  const activeDownloads = downloads.filter((d) => d.status === "running" || d.status === "queued").length;

  const items: { key: ViewKey; label: string; icon: (p: { size?: number }) => ReactElement }[] = [
    { key: "home", label: t("nav").home, icon: HomeIcon },
    { key: "nowPlaying", label: t("nav").nowPlaying, icon: PlayIcon },
    { key: "search", label: t("nav").search, icon: SearchIcon },
    { key: "library", label: t("nav").library, icon: ListIcon },
    { key: "wave", label: t("nav").wave, icon: WaveIcon },
    { key: "playlist", label: t("nav").playlist, icon: PlaylistIcon },
    { key: "downloads", label: t("nav").downloads, icon: DownloadIcon },
    { key: "settings", label: t("nav").settings, icon: SettingsIcon },
    { key: "queue", label: t("nav").queue, icon: QueueIcon2 },
  ];

  return (
    <aside className="sidebar">
      <button className="sidebar-logo" onClick={() => onView("home")} aria-label="Home">
        <WaveLogoMark size={78} />
      </button>
      <nav className="sidebar-nav" role="navigation" aria-label="Main navigation">
        {items.map((item) => (
          <button
            key={item.key}
            className={`nav-item ${view === item.key ? "active" : ""}`}
            onClick={() => onView(item.key)}
            aria-current={view === item.key ? "page" : undefined}
          >
            <item.icon size={18} />
            <span>{item.label}</span>
            {item.key === "downloads" && activeDownloads > 0 && (
              <span className="nav-badge">{activeDownloads}</span>
            )}
          </button>
        ))}
      </nav>
      <div className="sidebar-footer">
        <button className="nav-item" onClick={() => void openLocalDirectory()}>
          <FolderIcon size={18} />
          <span>{t("nav").localFiles}</span>
        </button>
      </div>
    </aside>
  );
}
