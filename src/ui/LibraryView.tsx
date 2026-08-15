import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { useApp } from "../app/stores";
import { useI18n } from "./I18nContext";
import type { HistoryEntry, Track } from "../core/types";
import { buildM3U } from "../core/library/m3u";
import { TrackRow } from "./TrackRow";
import { VirtualList } from "./VirtualList";
import { DownloadIcon, SearchIcon } from "./icons";

type Tab = "liked" | "history" | "local" | "stats";

export function LibraryView() {
  const { t } = useI18n();
  const services = useApp((s) => s.services);
  const likedIds = useApp((s) => s.likedIds);
  const localTracks = useApp((s) => s.localTracks);
  const [tab, setTab] = useState<Tab>("liked");
  const [liked, setLiked] = useState<Track[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    if (!services) return;
    void services.library.getLikedTracks().then((tracks) => {
      if (!cancelled) setLiked(tracks);
    });
    void services.history.getHistory(100).then((entries) => {
      if (!cancelled) setHistory(entries);
    });
    return () => {
      cancelled = true;
    };
  }, [services, likedIds]);

  return (
    <div className="view">
      <div className="tabs">
        <button className={`tab ${tab === "liked" ? "active" : ""}`} onClick={() => setTab("liked")}>
          {t("library").liked}
        </button>
        <button className={`tab ${tab === "history" ? "active" : ""}`} onClick={() => setTab("history")}>
          {t("library").history}
        </button>
        <button className={`tab ${tab === "local" ? "active" : ""}`} onClick={() => setTab("local")}>
          {t("library").local}
        </button>
        <button className={`tab ${tab === "stats" ? "active" : ""}`} onClick={() => setTab("stats")}>
          {t("library").stats}
        </button>
      </div>

      {tab === "liked" && (
        <TrackList
          tracks={liked}
          empty={t("library").emptyLiked}
          exportName="liked"
        />
      )}
      {tab === "history" && (
        <TrackList
          tracks={history.map((h) => h.track)}
          empty={t("library").emptyHistory}
          exportName="history"
        />
      )}
      {tab === "local" && (
        <TrackList
          tracks={localTracks}
          empty={t("library").emptyLocal}
          filterable
        />
      )}
      {tab === "stats" && <StatsView />}
    </div>
  );
}

function TrackList({ tracks, empty, exportName, filterable }: { tracks: Track[]; empty: string; exportName?: string; filterable?: boolean }) {
  const { t } = useI18n();
  const notify = useApp((s) => s.notify);
  const currentId = useApp((s) => s.snapshot.current?.id ?? null);
  const [filter, setFilter] = useState("");

  const visible = filterable
    ? tracks.filter((tr) => {
        const q = filter.toLowerCase();
        return (
          tr.title.toLowerCase().includes(q) ||
          (tr.artist ?? "").toLowerCase().includes(q) ||
          (tr.album ?? "").toLowerCase().includes(q)
        );
      })
    : tracks;

  // Волна «сейчас играет» — только на первом вхождении трека в списке,
  // чтобы одинаковые треки не мигали все сразу.
  const firstCurrent = visible.findIndex((tr) => tr.id === currentId);

  const exportTracks = async (format: "m3u" | "json") => {
    const path = await save({
      defaultPath: `${exportName}.${format === "m3u" ? "m3u" : "json"}`,
      filters: [{ name: format.toUpperCase(), extensions: [format] }],
    });
    if (!path) return;
    const content =
      format === "m3u"
        ? buildM3U(visible)
        : JSON.stringify(
            {
              format: "wave-library",
              version: 1,
              name: exportName,
              tracks: visible,
            },
            null,
            2,
          );
    try {
      await invoke("write_text_file", { path, content });
      notify(t("toasts").exportSuccess);
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e));
    }
  };

  if (tracks.length === 0) return <p className="muted">{empty}</p>;
  return (
    <div className="track-list">
      {filterable && (
        <div className="library-filter">
          <SearchIcon size={14} />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("search").filterPlaceholder}
          />
          <span className="library-count">
            {visible.length} / {tracks.length}
          </span>
        </div>
      )}
      {exportName && (
        <div className="header-actions library-export">
          <button className="btn small" onClick={() => void exportTracks("m3u")} title={t("playlist").exportM3U}>
            <DownloadIcon size={14} /> M3U
          </button>
          <button className="btn small" onClick={() => void exportTracks("json")} title={t("playlist").exportJSON}>
            <DownloadIcon size={14} /> JSON
          </button>
        </div>
      )}
      {visible.length === 0 ? (
        <p className="muted">{t("search").noResults}</p>
      ) : (
        <VirtualList
          items={visible}
          rowKey={(track, i) => `${track.id}:${i}`}
          renderRow={(track, i) => (
            <TrackRow track={track} index={i + 1} nowPlaying={firstCurrent === i} />
          )}
        />
      )}
    </div>
  );
}

function StatsView() {
  const { t } = useI18n();
  const history = useApp((s) => s.services?.history);
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [period, setPeriod] = useState<"day" | "week" | "month" | "all">("all");

  useEffect(() => {
    if (!history) return;
    void history.getHistory(2000).then(setEntries);
  }, [history]);

  const filtered = entries.filter((e) => {
    if (period === "all") return true;
    const ms = period === "day" ? 86400000 : period === "week" ? 7 * 86400000 : 30 * 86400000;
    return Date.now() - e.playedAt <= ms;
  });

  const totalPlays = filtered.length;
  const totalTime = filtered.reduce((sum, e) => sum + (e.track.duration ?? 0), 0);

  const artistCounts = new Map<string, number>();
  const trackCounts = new Map<string, { count: number; track: Track }>();
  for (const e of filtered) {
    const artist = e.track.artist ?? t("common").unknown;
    artistCounts.set(artist, (artistCounts.get(artist) ?? 0) + 1);
    const key = `${e.track.artist ?? ""} — ${e.track.title}`;
    trackCounts.set(key, { count: (trackCounts.get(key)?.count ?? 0) + 1, track: e.track });
  }

  const topArtists = [...artistCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const topTracks = [...trackCounts.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 10);

  const formatTime = (sec: number) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  return (
    <div className="view stats-view">
      <h2>{t("library").stats}</h2>
      <div className="stats-summary">
        <div className="stat-card">
          <span className="stat-value">{totalPlays}</span>
          <span className="stat-label">{t("library").totalPlays}</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{formatTime(totalTime)}</span>
          <span className="stat-label">{t("library").totalTime}</span>
        </div>
      </div>

       <div className="period-tabs">
        <button className={period === "day" ? "active" : ""} onClick={() => setPeriod("day")}>{t("library").periodDay}</button>
        <button className={period === "week" ? "active" : ""} onClick={() => setPeriod("week")}>{t("library").periodWeek}</button>
        <button className={period === "month" ? "active" : ""} onClick={() => setPeriod("month")}>{t("library").periodMonth}</button>
        <button className={period === "all" ? "active" : ""} onClick={() => setPeriod("all")}>{t("library").periodAll}</button>
      </div>

      <section>
        <h3>{t("library").topArtists}</h3>
        <div className="track-list">
          {topArtists.map(([artist, count], i) => (
            <div key={artist} className="track-row">
              <span className="track-index">{i + 1}</span>
              <div className="track-main">
                <span className="track-title">{artist}</span>
                <span className="track-artist">{count} {t("library").totalPlays}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3>{t("library").topTracks}</h3>
        <div className="track-list">
          {topTracks.map(([key, { count, track }], i) => (
            <TrackRow key={key} track={{ ...track, title: `${count}× ${track.title}` }} index={i + 1} />
          ))}
        </div>
      </section>
    </div>
  );
}
