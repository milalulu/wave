import { useCallback, useEffect, useMemo, useState } from "react";
import { normalizeGenre, detectMoods } from "../core/recommendations/moodTaxonomy";
import { AVAILABLE_LANGUAGES } from "../app/preferredLanguages";
import { useApp } from "../app/stores";
import { useI18n } from "./I18nContext";
import { TrackRow } from "./TrackRow";
import {
  WaveIcon,
  HeartIcon,
  ShuffleIcon,
  ChartIcon,
  RefreshCwIcon,
  TrashIcon,
} from "./icons";

function GenreBar({ label, count, max }: { label: string; count: number; max: number }) {
  const pct = max > 0 ? (count / max) * 100 : 0;
  return (
    <div className="wave-genre-row">
      <span className="wave-genre-label">{label}</span>
      <div className="wave-genre-bar">
        <div className="wave-genre-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="wave-genre-count">{count}</span>
    </div>
  );
}

export function WaveView() {
  const { t } = useI18n();
  const startWave = useApp((s) => s.startWave);
  const previewWave = useApp((s) => s.previewWave);
  const previewTracks = useApp((s) => s.previewTracks);
  const previewLoading = useApp((s) => s.previewLoading);
  const likedIds = useApp((s) => s.likedIds);
  const services = useApp((s) => s.services);
  const discoveryRate = useApp((s) => s.discoveryRate);
  const setDiscoveryRate = useApp((s) => s.setDiscoveryRate);
  const historyDecayDays = useApp((s) => s.historyDecayDays);
  const setHistoryDecayDays = useApp((s) => s.setHistoryDecayDays);
  const autoContinue = useApp((s) => s.autoContinue);
  const setAutoContinue = useApp((s) => s.setAutoContinue);
  const preferredLanguages = useApp((s) => s.preferredLanguages);
  const setPreferredLanguages = useApp((s) => s.setPreferredLanguages);
  const blockedTrackIds = useApp((s) => s.blockedTrackIds);
  const blockedArtists = useApp((s) => s.blockedArtists);
  const unblockArtist = useApp((s) => s.unblockArtist);
  const unblockAllTracks = useApp((s) => s.unblockAllTracks);
  const unblockAllArtists = useApp((s) => s.unblockAllArtists);
  const snapshot = useApp((s) => s.snapshot);

  const [genreStats, setGenreStats] = useState<Map<string, number>>(new Map());
  const [moodStats, setMoodStats] = useState<Record<string, number>>({});

  const providerNames = services?.providers.map((p) => p.name).join(", ") ?? "\u2014";

  const loadStats = useCallback(async () => {
    if (!services) return;
    const [history, liked] = await Promise.all([
      services.history.getHistory(500),
      services.library.getLikedTracks(),
    ]);
    const genres = new Map<string, number>();
    const moodCounts: Record<string, number> = {};
    for (const entry of history) {
      const g = entry.track.genre;
      if (g) {
        const n = normalizeGenre(g);
        genres.set(n, (genres.get(n) ?? 0) + 1);
      }
      const moods = detectMoods(
        entry.track.genre ? [entry.track.genre] : [],
        entry.track.title,
        entry.track.artist,
      );
      for (const m of moods) {
        moodCounts[m] = (moodCounts[m] ?? 0) + 1;
      }
    }
    for (const track of liked) {
      const g = track.genre;
      if (g) {
        const n = normalizeGenre(g);
        genres.set(n, (genres.get(n) ?? 0) + 1);
      }
    }
    setGenreStats(genres);
    setMoodStats(moodCounts);
  }, [services]);

  useEffect(() => {
    void loadStats();
  }, [loadStats, likedIds]);

  const sortedGenres = useMemo(() => [...genreStats.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8), [genreStats]);
  const maxGenreCount = sortedGenres[0]?.[1] ?? 0;
  const firstPreviewCurrent = useMemo(() => previewTracks.findIndex((tr) => tr.id === snapshot.current?.id), [previewTracks, snapshot.current?.id]);
  const sortedMoods = useMemo(() => Object.entries(moodStats)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8), [moodStats]);
  const maxMoodCount = sortedMoods[0]?.[1] ?? 0;

  return (
    <div className="view wave-view">
      {/* ── Hero ── */}
      <div className="wave-hero">
        <div className="wave-hero-bg">
          <div className="wave-hero-orb wave-hero-orb-1" />
          <div className="wave-hero-orb wave-hero-orb-2" />
          <div className="wave-hero-orb wave-hero-orb-3" />
          <svg className="wave-hero-svg" viewBox="0 0 1200 200" preserveAspectRatio="none">
            <path className="wave-hero-path wave-hero-path-1" d="M0,100 C200,150 400,50 600,100 C800,150 1000,50 1200,100 L1200,200 L0,200Z" />
            <path className="wave-hero-path wave-hero-path-2" d="M0,120 C300,80 500,160 700,110 C900,60 1100,140 1200,120 L1200,200 L0,200Z" />
            <path className="wave-hero-path wave-hero-path-3" d="M0,140 C150,110 350,170 600,130 C850,90 1050,160 1200,140 L1200,200 L0,200Z" />
          </svg>
        </div>
        <div className="wave-hero-inner">
          <div className="wave-hero-icon">
            <WaveIcon size={40} />
          </div>
          <h1 className="wave-hero-title">{t("wave").title}</h1>
          <p className="wave-hero-desc">{t("wave").empty}</p>
          <div className="wave-hero-actions">
            <button
              className="btn btn-primary btn-lg wave-start-btn"
              onClick={() => void startWave()}
            >
              <WaveIcon size={20} />
              {t("wave").start}
            </button>
            <button
              className="btn btn-hero-secondary wave-preview-btn"
              onClick={() => void previewWave()}
              disabled={previewLoading}
            >
              {previewLoading ? <RefreshCwIcon size={18} className="spin" /> : <ChartIcon size={18} />}
              {t("wave").preview}
            </button>
          </div>
          <p className="wave-hero-hint">{t("wave").hint}</p>
        </div>
      </div>

      {/* ── Stats Grid ── */}
      <div className="wave-stats-grid">
        <div className="wave-stat-card">
          <div className="wave-stat-icon wave-stat-icon-heart">
            <HeartIcon size={20} filled />
          </div>
          <div className="wave-stat-value">{likedIds.size}</div>
          <div className="wave-stat-label">{t("library").liked}</div>
        </div>
        <div className="wave-stat-card">
          <div className="wave-stat-icon wave-stat-icon-discovery">
            <ShuffleIcon size={20} />
          </div>
          <div className="wave-stat-value">{discoveryRate}%</div>
          <div className="wave-stat-label">{t("settings").discoveryRate}</div>
        </div>
        <div className="wave-stat-card">
          <div className="wave-stat-icon wave-stat-icon-decay">
            <ChartIcon size={20} />
          </div>
          <div className="wave-stat-value">{historyDecayDays}d</div>
          <div className="wave-stat-label">{t("settings").historyDecay}</div>
        </div>
        <div className="wave-stat-card">
          <div className="wave-stat-icon wave-stat-icon-sources">
            <WaveIcon size={20} />
          </div>
          <div className="wave-stat-value wave-stat-value-sm">{providerNames}</div>
          <div className="wave-stat-label">{t("nav").search}</div>
        </div>
      </div>

      {/* ── Controls Row ── */}
      <div className="wave-controls">
        {/* Discovery Rate */}
        <div className="wave-control-card">
          <div className="wave-control-header">
            <ShuffleIcon size={16} />
            <span>{t("settings").discoveryRate}</span>
            <span className="wave-control-value">{discoveryRate}%</span>
          </div>
          <p className="wave-control-desc">{t("settings").discoveryRateDesc}</p>
          <input
            type="range"
            className="wave-slider"
            min={0}
            max={100}
            value={discoveryRate}
            onChange={(e) => setDiscoveryRate(Number(e.target.value))}
          />
          <div className="wave-control-range">
            <span>{t("library").liked}</span>
            <span>{t("wave").title}</span>
          </div>
        </div>

        {/* History Decay */}
        <div className="wave-control-card">
          <div className="wave-control-header">
            <ChartIcon size={16} />
            <span>{t("settings").historyDecay}</span>
            <span className="wave-control-value">{historyDecayDays}{t("settings").days}</span>
          </div>
          <p className="wave-control-desc">{t("settings").historyDecayDesc}</p>
          <input
            type="range"
            className="wave-slider"
            min={7}
            max={90}
            value={historyDecayDays}
            onChange={(e) => setHistoryDecayDays(Number(e.target.value))}
          />
          <div className="wave-control-range">
            <span>7{t("settings").days}</span>
            <span>90{t("settings").days}</span>
          </div>
        </div>

        {/* Auto-continue */}
        <div className="wave-control-card wave-control-toggle">
          <div className="wave-control-header">
            <WaveIcon size={16} />
            <span>{t("wave").autoContinue}</span>
            <label className="wave-toggle">
              <input
                type="checkbox"
                checked={autoContinue}
                onChange={(e) => setAutoContinue(e.target.checked)}
              />
              <span className="wave-toggle-track" />
            </label>
          </div>
          <p className="wave-control-desc">{t("wave").autoContinueDesc}</p>
        </div>

        {/* Languages */}
        <div className="wave-control-card wave-control-languages">
          <div className="wave-control-header">
            <span>{t("wave").languages}</span>
          </div>
          <p className="wave-control-desc">{t("wave").languagesDesc}</p>
          <div className="wave-lang-chips">
            {AVAILABLE_LANGUAGES.map((lang) => {
              const active = preferredLanguages.includes(lang.code);
              return (
                <button
                  key={lang.code}
                  className={`wave-lang-chip ${active ? "active" : ""}`}
                  onClick={() => {
                    if (active) {
                      setPreferredLanguages(preferredLanguages.filter((c) => c !== lang.code));
                    } else {
                      setPreferredLanguages([...preferredLanguages, lang.code]);
                    }
                  }}
                >
                  {lang.label}
                </button>
              );
            })}
          </div>
          {preferredLanguages.length > 0 && (
            <button
              className="btn small wave-lang-clear"
              onClick={() => setPreferredLanguages([])}
            >
              {t("wave").languagesNone}
            </button>
          )}
        </div>
      </div>

      {/* ── Preview ── */}
      {previewTracks.length > 0 && (
        <div className="wave-section">
          <div className="wave-section-header">
            <h2>{t("wave").preview}</h2>
            <button className="btn wave-refresh-btn" onClick={() => void previewWave()}>
              <RefreshCwIcon size={14} />
              {t("wave").refresh}
            </button>
          </div>
          <p className="wave-section-desc">{t("wave").previewHint}</p>
          <div className="track-list">
            {previewTracks.map((track, i) => (
              <TrackRow
                key={`${track.id}:${i}`}
                track={track}
                index={i}
                nowPlaying={firstPreviewCurrent === i}
              />
            ))}
          </div>
          <button
            className="btn btn-primary wave-play-preview-btn"
            onClick={() => void startWave()}
          >
            <WaveIcon size={18} />
            {t("wave").playPreview}
          </button>
        </div>
      )}

      {/* ── Blocked ── */}
      {(blockedTrackIds.length > 0 || blockedArtists.length > 0) && (
        <div className="wave-section">
          <h2>{t("wave").blocked}</h2>
          <p className="wave-section-desc">{t("wave").blockedDesc}</p>
          {blockedTrackIds.length > 0 && (
            <div className="wave-blocked-row">
              <span className="wave-blocked-label">{t("wave").blockedTracks} ({blockedTrackIds.length})</span>
              <button className="btn small" onClick={unblockAllTracks}>{t("wave").unblockAll}</button>
            </div>
          )}
          <div className="wave-blocked-list">
            {blockedArtists.map((name) => (
              <div key={`a:${name}`} className="wave-blocked-chip">
                <span>{name}</span>
                <button
                  className="wave-unblock-btn"
                  onClick={() => unblockArtist(name)}
                  aria-label={t("wave").unblock}
                >
                  <TrashIcon size={14} />
                </button>
              </div>
            ))}
            {blockedArtists.length > 1 && (
              <button className="btn small" onClick={unblockAllArtists}>{t("wave").unblockAll}</button>
            )}
          </div>
        </div>
      )}

      {/* ── Genres ── */}
      {sortedGenres.length > 0 && (
        <div className="wave-section">
          <h2>{t("wave").genres}</h2>
          <p className="wave-section-desc">{t("wave").genresDesc}</p>
          <div className="wave-genres-list">
            {sortedGenres.map(([label, count]) => (
              <GenreBar key={label} label={label} count={count} max={maxGenreCount} />
            ))}
          </div>
        </div>
      )}

      {/* ── Moods ── */}
      {sortedMoods.length > 0 && (
        <div className="wave-section">
          <h2>{t("wave").moods}</h2>
          <p className="wave-section-desc">{t("wave").moodsDesc}</p>
          <div className="wave-genres-list">
            {sortedMoods.map(([label, count]) => (
              <GenreBar key={label} label={label} count={count} max={maxMoodCount} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
