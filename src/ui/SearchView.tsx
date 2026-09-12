import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useApp } from "../app/stores";
import { useI18n } from "./I18nContext";
import { searchAll } from "../app/compose";
import { getCachedResults, setCachedResults } from "../app/searchCache";
import { getSuggestions } from "../core/search/suggest";
import type { Album, Artist, SearchResults, Track } from "../core/types";
import { TrackRow } from "./TrackRow";
import { VirtualList } from "./VirtualList";
import { Cover } from "./Cover";
import { providerLabel } from "./providers";
import { SearchIcon, RefreshCwIcon, MicIcon } from "./icons";
import { tileStyle } from "./tileHue";
import { EmptyState } from "./EmptyState";

interface WebSpeechRecognition {
  lang: string;
  onresult: ((e: { results: { transcript: string }[][] }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

interface SearchViewProps {
  query: string;
  onQuery: (q: string) => void;
  focusToken?: number;
}

const FILTER_KEY = "wave-search-providers";
const RECENT_KEY = "wave-recent-searches";
const MAX_RECENT = 12;

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function saveRecent(q: string): void {
  if (!q.trim()) return;
  const recent = loadRecent().filter((r) => r !== q);
  recent.unshift(q);
  if (recent.length > MAX_RECENT) recent.length = MAX_RECENT;
  localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
}

function clearRecent(): void {
  localStorage.removeItem(RECENT_KEY);
}

function loadFilter(): string[] | null {
  try {
    const raw = localStorage.getItem(FILTER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : null;
  } catch {
    return null;
  }
}

export function SearchView({ query, onQuery, focusToken }: SearchViewProps) {
  const { t } = useI18n();
  const providers = useApp((s) => s.services?.providers ?? []);
  const excludePreviews = useApp((s) => s.excludePreviews);
  const setExcludePreviews = useApp((s) => s.setExcludePreviews);
  const [input, setInput] = useState(query);
  const [results, setResults] = useState<SearchResults[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [selected, setSelected] = useState<string[] | null>(loadFilter());
  const [recentSearches, setRecentSearches] = useState<string[]>(() => loadRecent());
  const [suggestHidden, setSuggestHidden] = useState(false);
  const [suggestPool, setSuggestPool] = useState<{ liked: Track[]; history: Track[] } | null>(null);
  const library = useApp((s) => s.services?.library);
  const historyApi = useApp((s) => s.services?.history);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<number | undefined>(undefined);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    if (!library || !historyApi || suggestPool) return;
    let cancelled = false;
    void Promise.all([
      library.getLikedTracks().catch(() => [] as Track[]),
      historyApi
        .getHistory(200)
        .then((h) => h.map((e) => e.track))
        .catch(() => [] as Track[]),
    ]).then(([liked, history]) => {
      if (!cancelled) setSuggestPool({ liked, history });
    });
    return () => {
      cancelled = true;
    };
  }, [library, historyApi, suggestPool]);

  const suggestions = useMemo(
    () =>
      suggestPool && input.trim() && !suggestHidden
        ? getSuggestions(input, { ...suggestPool, recent: recentSearches })
        : [],
    [input, suggestPool, recentSearches, suggestHidden],
  );

  const applySuggestion = (title: string, artist?: string): void => {
    const q = artist ? `${artist} ${title}`.trim() : title;
    setInput(q);
    setSuggestHidden(true);
    onQuery(q);
    saveRecent(q);
    setRecentSearches(loadRecent());
    inputRef.current?.blur();
  };

  useEffect(() => {
    setInput(query);
  }, [query]);

  useEffect(() => {
    if (focusToken !== undefined && focusToken > 0) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [focusToken]);

  useEffect(() => {
    window.clearTimeout(debounceRef.current);
    if (!input.trim()) {
      setResults(null);
      return;
    }
    debounceRef.current = window.setTimeout(() => {
      onQuery(input.trim());
    }, 300);
    return () => window.clearTimeout(debounceRef.current);
  }, [input, onQuery]);

  const enabledProviders = useMemo(
    () => (selected && selected.length > 0 ? providers.filter((p) => selected.includes(p.id)) : providers),
    [providers, selected],
  );

  useEffect(() => {
    if (!query.trim()) {
      setResults(null);
      return;
    }
    const cacheKey = `${query}:${(selected ?? []).sort().join(",")}`;
    const cached = getCachedResults(cacheKey);
    if (cached) {
      setResults(cached);
      return;
    }
    if (enabledProviders.length === 0) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    searchAll(enabledProviders, query)
      .then((r) => {
        if (cancelled) return;
        setCachedResults(cacheKey, r);
        setResults(r);
        const engine = useApp.getState().services?.engine;
        if (engine) {
          const topTracks = r.flatMap((s) => s.tracks.slice(0, 3));
          engine.preResolve(topTracks);
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [query, enabledProviders, selected, retryToken]);

  const toggleProvider = (id: string): void => {
    setSelected((prev) => {
      const base = prev ?? providers.map((p) => p.id);
      const next = base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
      localStorage.setItem(FILTER_KEY, JSON.stringify(next));
      return next.length === providers.length ? null : next;
    });
  };

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    window.clearTimeout(debounceRef.current);
    onQuery(input.trim());
    setSuggestHidden(true);
    if (input.trim()) {
      saveRecent(input.trim());
      setRecentSearches(loadRecent());
    }
  };

  const applyVoiceText = (text: string): void => {
    const q = text.trim();
    if (!q) return;
    setInput(q);
    onQuery(q);
    saveRecent(q);
    setRecentSearches(loadRecent());
  };

  const voiceSearch = (): void => {
    if (listening) return;
    setListening(true);
    const done = () => setListening(false);
    // 1. Нативный Android-диалог распознавания.
    invoke<string>("recognize_speech", {})
      .then((text) => {
        done();
        if (text) applyVoiceText(text);
      })
      .catch(() => {
        // 2. Web Speech API (десктопный Chrome).
        try {
          const Ctor = (
            window as unknown as {
              webkitSpeechRecognition?: new () => WebSpeechRecognition;
              SpeechRecognition?: new () => WebSpeechRecognition;
            }
          ).webkitSpeechRecognition ?? (
            window as unknown as { SpeechRecognition?: new () => WebSpeechRecognition }
          ).SpeechRecognition;
          if (!Ctor) {
            done();
            setError(t("search").voiceUnsupported);
            return;
          }
          const rec = new Ctor();
          rec.onresult = (e) => {
            const text = e.results?.[0]?.[0]?.transcript ?? "";
            done();
            if (text) applyVoiceText(text);
          };
          rec.onerror = () => {
            done();
          };
          rec.onend = () => {
            done();
          };
          rec.start();
        } catch {
          done();
          setError(t("search").voiceUnsupported);
        }
      });
  };

  const allSelected = selected === null || selected.length === providers.length;

  return (
    <div className="view search-view">
      <form className="search-box" onSubmit={handleSubmit}>
        <SearchIcon size={18} />
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setSuggestHidden(false);
          }}
          placeholder={t("search").placeholder}
        />
        {input && (
          <button type="button" className="icon-btn search-clear" onClick={() => { setInput(""); onQuery(""); }}>
            ✕
          </button>
        )}
        <button
          type="button"
          className={`icon-btn ${listening ? "active" : ""}`}
          title={t("search").voice}
          aria-label={t("search").voice}
          onClick={voiceSearch}
        >
          <MicIcon size={18} />
        </button>
        <button className="btn" type="submit" disabled={loading}>
          {loading ? t("common").loading : t("common").search}
        </button>
      </form>

      {suggestions.length > 0 && (
        <div className="suggest-list" role="listbox">
          {suggestions.map((s) => (
            <button
              key={`${s.kind}:${s.artist ?? ""}:${s.title}`}
              role="option"
              aria-selected="false"
              className="suggest-item"
              onClick={() => applySuggestion(s.title, s.artist)}
            >
              <SearchIcon size={14} />
              <span>{s.kind === "track" && s.artist ? `${s.artist} — ${s.title}` : s.title}</span>
            </button>
          ))}
        </div>
      )}

      <div className="provider-filters">
        <button
          className={`chip ${allSelected ? "active" : ""}`}
          onClick={() => {
            setSelected(null);
            localStorage.setItem(FILTER_KEY, JSON.stringify(providers.map((p) => p.id)));
          }}
        >
          {t("search").allProviders}
        </button>
        {providers.map((p) => (
          <button
            key={p.id}
            className={`chip ${!allSelected && selected?.includes(p.id) ? "active" : ""}`}
            onClick={() => toggleProvider(p.id)}
            title={p.name}
          >
            {providerLabel(p.id)}
          </button>
        ))}
      </div>

      {error && (
        <p className="error">
          {error}{" "}
          <button className="btn small" onClick={() => { setError(null); setRetryToken((n) => n + 1); }}>
            <RefreshCwIcon size={14} /> {t("common").retry}
          </button>
        </p>
      )}
      {loading && (
        <div className="skeleton-results">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton-row">
              <div className="skeleton-cover" />
              <div className="skeleton-text">
                <div className="skeleton-line w80" />
                <div className="skeleton-line w50" />
              </div>
            </div>
          ))}
        </div>
      )}
      {!input.trim() && recentSearches.length > 0 && (
        <div className="recent-searches">
          <div className="recent-header">
            <span className="muted">{t("search").recentSearches}</span>
            <button className="btn small" onClick={() => { clearRecent(); setRecentSearches([]); }}>
              {t("search").clearRecent}
            </button>
          </div>
          <div className="recent-chips">
            {recentSearches.map((q) => (
              <button key={q} className="chip" onClick={() => { setInput(q); onQuery(q); saveRecent(q); setRecentSearches(loadRecent()); }}>
                {q}
              </button>
            ))}
          </div>
        </div>
      )}
      {results && (
        <Results
          results={results}
          excludePreviews={excludePreviews}
          onShowPreviews={() => setExcludePreviews(false)}
        />
      )}
    </div>
  );
}

function Results({
  results,
  excludePreviews,
  onShowPreviews,
}: {
  results: SearchResults[];
  excludePreviews: boolean;
  onShowPreviews: () => void;
}) {
  const { t } = useI18n();
  const tracks = results.flatMap((r) => r.tracks);
  const albums = results.flatMap((r) => r.albums);
  const artists = results.flatMap((r) => r.artists);
  
  
  const previewsHidden = excludePreviews && tracks.length === 0 && (albums.length > 0 || artists.length > 0);

  return (
    <div className="results">
      {(tracks.length > 0 || albums.length > 0 || artists.length > 0) && (
        <p className="muted search-count">
          {tracks.length} {t("search").tracks.toLowerCase()} · {" "}
          {albums.length} {t("search").albums.toLowerCase()} · {" "}
          {artists.length} {t("search").artists.toLowerCase()}
        </p>
      )}
      {previewsHidden && (
        <p className="muted">
          {t("search").previewsHidden}{" "}
          <button className="btn small" onClick={onShowPreviews}>
            {t("search").showPreviews}
          </button>
        </p>
      )}
      {tracks.length > 0 && (
        <section>
          <h2>{t("search").tracks}</h2>
          <div className="track-list">
            <VirtualList
              items={tracks}
              rowKey={(track) => `${track.provider}:${track.id}`}
              renderRow={(track, i) => <TrackRow track={track} index={i + 1} />}
            />
          </div>
        </section>
      )}

      {albums.length > 0 && (
        <section>
          <h2>{t("search").albums}</h2>
          <div className="card-grid">
            {albums.map((album) => (
              <AlbumCard key={album.id} album={album} />
            ))}
          </div>
        </section>
      )}

      {artists.length > 0 && (
        <section>
          <h2>{t("search").artists}</h2>
          <div className="card-grid">
            {artists.map((artist) => (
              <ArtistCard key={artist.id} artist={artist} />
            ))}
          </div>
        </section>
      )}

      {tracks.length === 0 && albums.length === 0 && artists.length === 0 && (
        <EmptyState
          title={t("search").noResults}
          message={t("search").noResultsHint}
          icon={<SearchIcon size={28} />}
          compact
        />
      )}
    </div>
  );
}

export function AlbumCard({ album, onClick }: { album: Album; onClick?: () => void }) {
  const { t } = useI18n();
  const loadAlbum = useApp((s) => s.loadAlbum);
  const handleClick = () => {
    if (onClick) onClick();
    else loadAlbum(album.provider, album.id);
  };
  return (
    <button className="media-card" onClick={handleClick} title={`${t("common").open}: ${album.title}`}>
      {album.coverUrl ? (
        <Cover src={album.coverUrl} alt="" />
      ) : (
        <div className="media-card-empty" style={tileStyle(album.title)}>{album.title.charAt(0).toUpperCase()}</div>
      )}
      <span className="media-card-title">{album.title}</span>
      <small>{album.artist}</small>
    </button>
  );
}

export function ArtistCard({ artist, onClick }: { artist: Artist; onClick?: () => void }) {
  const { t } = useI18n();
  const loadArtist = useApp((s) => s.loadArtist);
  const handleClick = () => {
    if (onClick) onClick();
    else loadArtist(artist.provider, artist.id);
  };
  return (
    <button className="media-card" onClick={handleClick} title={`${t("common").open}: ${artist.name}`}>
      <div className="media-card-empty artist" style={tileStyle(artist.name)}>{artist.name.charAt(0)}</div>
      <span className="media-card-title">{artist.name}</span>
      <small>{t("search").artists}</small>
    </button>
  );
}
