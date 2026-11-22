import type { ReactNode, RefObject } from "react";
import type { ViewKey } from "./Sidebar";
import { useI18n } from "./I18nContext";
import { useApp } from "../app/stores";

export function AppShell({ view, navigation, contentRef, children, player, mobile, notices }: {
  view: ViewKey;
  navigation: ReactNode;
  contentRef: RefObject<HTMLElement | null>;
  children: ReactNode;
  player: ReactNode;
  mobile: ReactNode;
  notices: ReactNode;
}) {
  const { locale, t } = useI18n();
  const temporaryStorage = useApp((s) => s.services?.storageBackend === "memory");
  return <div className="app pulse-shell" data-view={view}>
    <a className="skip-content" href="#wave-main">{locale === "ru" ? "Перейти к содержимому" : "Skip to content"}</a>
    <div className="pulse-backdrop" aria-hidden="true"><span className="echoes-art-waves" /><span className="pulse-backdrop-lower" /></div>
    <div className="pulse-rail-art" aria-hidden="true" />
    {navigation}
    <main id="wave-main" tabIndex={-1} ref={contentRef} className={`content ${view === "nowPlaying" ? "content-nowplaying" : ""}`}>
      {temporaryStorage && <div className="storage-warning" role="status">{locale === "ru"
        ? "База медиатеки недоступна. Изменения в избранном, истории и плейлистах сохранятся только до закрытия Wave."
        : "The library database is unavailable. Changes to favorites, history and playlists last until Wave closes."}</div>}
      {(view === "search" || view === "library") && <header className="section-heading"><span aria-hidden="true">wave /</span><h1>{t("nav")[view]}</h1></header>}
      {children}
    </main>
    {player}{mobile}{notices}
  </div>;
}
