import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../app/stores";
import { useI18n } from "./I18nContext";
import { searchAll } from "../app/compose";
import { streamPrewarmer } from "../core/player/streamPrewarm";
import { getCachedResults, setCachedResults } from "../app/searchCache";
import type { Album, Artist, SearchResults } from "../core/types";
import { TrackRow } from "./TrackRow";
import { VirtualList } from "./VirtualList";
import { Cover } from "./Cover";
import { providerLabel } from "./providers";
import { SearchIcon, RefreshCwIcon } from "./icons";

interface SearchViewProps {
  query: string;
  onQuery: (q: string) => void;
  focusToken?: number;
}

const FILTER_KEY = "wave-search-providers";

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
  const [selected, setSelected] = useState<string[] | null>(loadFilter());
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<number | undefined>(undefined);

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
      streamPrewarmer.prewarm(cached.flatMap((r) => r.tracks));
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
        streamPrewarmer.prewarm(r.flatMap((x) => x.tracks));
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
  }, [query, enabledProviders, selected]);

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
  };

  const allSelected = selected === null || selected.length === providers.length;

  return (
    <div className="view search-view">
      <form className="search-box" onSubmit={handleSubmit}>
        <SearchIcon size={18} />
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t("search").placeholder}
        />
        {input && (
          <button type="button" className="icon-btn search-clear" onClick={() => { setInput(""); onQuery(""); }}>
            ✕
          </button>
        )}
        <button className="btn" type="submit" disabled={loading}>
          {loading ? t("common").loading : t("search").placeholder}
        </button>
      </form>

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
          <button className="btn small" onClick={() => { setError(null); onQuery(query); }}>
            <RefreshCwIcon size={14} /> Retry
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
        <p className="muted">{t("search").noResults}</p>
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
        <div className="media-card-empty">{album.title.charAt(0).toUpperCase()}</div>
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
      <div className="media-card-empty artist">{artist.name.charAt(0)}</div>
      <span className="media-card-title">{artist.name}</span>
      <small>{t("search").artists}</small>
    </button>
  );
}
