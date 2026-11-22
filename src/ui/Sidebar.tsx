import { useI18n } from "./I18nContext";
import { EchoesMark } from "./EchoesMark";
import { SidebarIcon } from "./SidebarIcon";

export type ViewKey = "home" | "nowPlaying" | "search" | "library" | "queue" | "wave" | "album" | "artist" | "artistRadio" | "playlist" | "settings" | "downloads" | "wrapped" | "agent";

interface SidebarProps {
  view: ViewKey;
  onView: (view: ViewKey) => void;
}

export function Sidebar({ view, onView }: SidebarProps) {
  const { t } = useI18n();
  const items: { key: ViewKey; label: string }[] = [
    {key: "home", label: t("nav").home},
    {key: "search", label: t("nav").search},
    {key: "library", label: t("nav").library},
    {key: "wave", label: t("nav").wave},
    {key: "playlist", label: t("nav").playlist},
  ];  return (
    <aside className="sidebar">
      <button className="sidebar-logo" onClick={() => onView("home")} aria-label="Home">
        <span className="echoes-brand-bars"><EchoesMark compact /></span><span className="echoes-brand-name">wave</span>
      </button>
      <nav className="sidebar-nav" role="navigation" aria-label="Main navigation">
        {items.map((item) => (
          <button
            key={item.key}
            className={`nav-item ${view === item.key ? "active" : ""}`}
            onClick={() => onView(item.key)}
            aria-current={view === item.key ? "page" : undefined}
            aria-label={item.label}
            title={item.label}
          >
            <SidebarIcon name={item.key} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
      <div className="sidebar-footer">
        <button className={`nav-item ${view === "settings" ? "active" : ""}`} aria-current={view === "settings" ? "page" : undefined} aria-label={t("nav").settings} title={t("nav").settings} onClick={() => onView("settings")}>
          <SidebarIcon name="settings"/><span>{t("nav").settings}</span>
        </button>      </div>
    </aside>
  );
}
