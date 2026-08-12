import { useEffect, useRef, useState } from "react";
import { useApp } from "../app/stores";
import { useI18n } from "./I18nContext";
import { searchAll } from "../app/compose";
import { getCachedResults, setCachedResults } from "../app/searchCache";
import type { Album, Artist, SearchResults } from "../core/types";
import { TrackRow } from "./TrackRow";
import { Cover } from "./Cover";
import { SearchIcon } from "./icons";

interface SearchViewProps {
  query: string;
  onQuery: (q: string) => void;
}

export function SearchView({ query, onQuery }: SearchViewProps) {
  const { t } = useI18n();
  const [input, setInput] = useState(query);
  const [results, setResults] = useState<SearchResults[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    setInput(query);
  }, [query]);

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

  useEffect(() => {
    if (!query.trim()) {
      setResults(null);
      return;
    }
    const cached = getCachedResults(query);
    if (cached) {
      setResults(cached);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const providers = useApp.getState().services?.providers ?? [];
    searchAll(providers, query)
      .then((r) => {
        if (cancelled) return;
        setCachedResults(query, r);
        setResults(r);
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
  }, [query]);

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    window.clearTimeout(debounceRef.current);
    onQuery(input.trim());
  };

  return (
    <div className="view search-view">
      <form className="search-box" onSubmit={handleSubmit}>
        <SearchIcon size={18} />
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t("search").placeholder}
          autoFocus
        />
        <button className="btn" type="submit" disabled={loading}>
          {loading ? t("common").loading : t("search").placeholder}
        </button>
      </form>

      {error && <p className="error">{error}</p>}
      {loading && <p className="muted">{t("common").loading}</p>}
      {results && <Results results={results} />}
    </div>
  );
}

function Results({ results }: { results: SearchResults[] }) {
  const { t } = useI18n();
  const tracks = results.flatMap((r) => r.tracks);
  const albums = results.flatMap((r) => r.albums);
  const artists = results.flatMap((r) => r.artists);

  return (
    <div className="results">
      {tracks.length > 0 && (
        <section>
          <h2>{t("search").tracks}</h2>
          <div className="track-list">
            {tracks.map((track, i) => (
              <TrackRow key={track.id} track={track} index={i + 1} />
            ))}
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
        <div className="media-card-empty">A</div>
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
