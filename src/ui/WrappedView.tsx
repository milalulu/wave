import { useEffect, useMemo, useState } from "react";
import { useApp } from "../app/stores";
import { useI18n } from "./I18nContext";
import { Cover } from "./Cover";
import { ChartIcon, ShareIcon } from "./icons";
import type { HistoryEntry } from "../core/types";
import {
  computeWrapped,
  drawWrappedCard,
  filterWrappedPeriod,
  type CardCtx,
  type WrappedPeriod,
} from "../core/library/wrapped";

const PERIODS: WrappedPeriod[] = ["week", "month", "year", "all"];

export function WrappedView() {
  const { t } = useI18n();
  const history = useApp((s) => s.services?.history);
  const notify = useApp((s) => s.notify);
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [period, setPeriod] = useState<WrappedPeriod>("month");

  useEffect(() => {
    if (!history) return;
    let cancelled = false;
    void history.getHistory(5000).then((list) => {
      if (!cancelled) setEntries(list);
    });
    return () => {
      cancelled = true;
    };
  }, [history]);

  const stats = useMemo(
    () => computeWrapped(filterWrappedPeriod(entries, period)),
    [entries, period],
  );

  const periodLabel = (p: WrappedPeriod): string => {
    switch (p) {
      case "week":
        return t("library").periodWeek;
      case "month":
        return t("library").periodMonth;
      case "year":
        return t("library").periodYear;
      case "all":
        return t("library").periodAll;
    }
  };

  const share = () => {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 1080;
      canvas.height = 1920;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d context");
      drawWrappedCard(ctx as unknown as CardCtx, stats, `${t("nav").wrapped} · ${periodLabel(period)}`);
      const a = document.createElement("a");
      a.href = canvas.toDataURL("image/png");
      a.download = `wave-wrapped-${period}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e));
    }
  };

  if (entries.length === 0) {
    return (
      <div className="view wrapped-view">
        <h1>{t("nav").wrapped}</h1>
        <div className="empty-state">
          <ChartIcon size={48} />
          <h2>{t("wrapped").empty}</h2>
          <p>{t("wrapped").emptyHint}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="view wrapped-view">
      <header className="view-header">
        <h1>{t("nav").wrapped}</h1>
        <div className="header-actions">
          <button className="btn" onClick={share}>
            <ShareIcon size={18} /> {t("wrapped").share}
          </button>
        </div>
      </header>
      <div className="period-tabs">
        {PERIODS.map((p) => (
          <button key={p} className={period === p ? "active" : ""} onClick={() => setPeriod(p)}>
            {periodLabel(p)}
          </button>
        ))}
      </div>
      <div className="wrapped-hero">
        <div className="wrapped-stat-main">
          <span className="wrapped-big">{stats.minutes}</span>
          <span className="wrapped-label">{t("wrapped").minutes}</span>
        </div>
        <div className="wrapped-stats-row">
          <div className="wrapped-stat">
            <span className="wrapped-value">{stats.plays}</span>
            <span className="wrapped-label">{t("wrapped").plays}</span>
          </div>
          <div className="wrapped-stat">
            <span className="wrapped-value">{stats.streakDays}</span>
            <span className="wrapped-label">{t("wrapped").streak}</span>
          </div>
          <div className="wrapped-stat">
            <span className="wrapped-value">{stats.activeDays}</span>
            <span className="wrapped-label">{t("wrapped").activeDays}</span>
          </div>
        </div>
      </div>
      <section>
        <h2>{t("wrapped").topArtists}</h2>
        <div className="wrapped-list">
          {stats.topArtists.map((a, i) => (
            <div key={a.name} className="wrapped-row">
              <span className="wrapped-rank">{i + 1}</span>
              <span className="wrapped-name">{a.name}</span>
              <span className="wrapped-meta">{a.plays} · {a.minutes}m</span>
            </div>
          ))}
        </div>
      </section>
      <section>
        <h2>{t("wrapped").topTracks}</h2>
        <div className="wrapped-list">
          {stats.topTracks.map((tr, i) => (
            <div key={`${tr.artist}-${tr.title}-${i}`} className="wrapped-row">
              <span className="wrapped-rank">{i + 1}</span>
              {tr.coverUrl ? (
                <Cover className="wrapped-cover" src={tr.coverUrl} alt="" />
              ) : (
                <span className="wrapped-cover wrapped-cover-empty">{tr.title.charAt(0)}</span>
              )}
              <span className="wrapped-main">
                <span className="wrapped-name">{tr.title}</span>
                <span className="wrapped-artist">{tr.artist}</span>
              </span>
              <span className="wrapped-meta">{tr.plays}×</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
