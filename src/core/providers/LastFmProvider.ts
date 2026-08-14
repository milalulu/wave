import type { Album, Artist, SearchResults, Track } from "../types";
import type { AlbumDetail, ArtistDetail } from "../types";
import type { MusicProvider } from "./MusicProvider";
import type { HttpJsonGateway } from "./HttpGateway";

const API = "https://ws.audioscrobbler.com/2.0";

interface LfmImage {
  size: string;
  "#text": string;
}

interface LfmTrack {
  name?: string;
  artist?: string;
  mbid?: string;
  url?: string;
  duration?: string;
  listeners?: string;
  image?: LfmImage[];
}

interface LfmAlbum {
  name?: string;
  artist?: string;
  mbid?: string;
  url?: string;
  image?: LfmImage[];
}

interface LfmArtist {
  name?: string;
  mbid?: string;
  url?: string;
  image?: LfmImage[];
}

interface LfmSearchResults {
  results?: {
    trackmatches?: { track?: LfmTrack[] };
    albummatches?: { album?: LfmAlbum[] };
    artistmatches?: { artist?: LfmArtist[] };
  };
}

function bigImage(images?: LfmImage[]): string | undefined {
  if (!images) return undefined;
  const found = images.find((i) => i.size === "extralarge" || i.size === "large");
  return found?.["#text"] || undefined;
}

/**
 * Провайдер Last.fm (метаданные, API key из конфига). Аудио не стримится —
 * треки помечаются meta.noPlay и исключаются из воспроизведения.
 */
export class LastFmProvider implements MusicProvider {
  readonly id = "lastfm";
  readonly name = "Last.fm";

  constructor(
    private http: HttpJsonGateway,
    private apiKey: string,
  ) {}

  async search(query: string): Promise<SearchResults> {
    const tracks: Track[] = [];
    const albums: Album[] = [];
    const artists: Artist[] = [];
    const [t, a, ar] = await Promise.allSettled([
      this.call<LfmSearchResults>("track.search", query),
      this.call<LfmSearchResults>("album.search", query),
      this.call<LfmSearchResults>("artist.search", query),
    ]);
    if (t.status === "fulfilled") {
      for (const r of t.value?.results?.trackmatches?.track ?? []) {
        if (!r.name) continue;
        tracks.push({
          id: r.mbid ? `lastfm:track:${r.mbid}` : `lastfm:track:${r.artist}:${r.name}`,
          provider: this.id,
          uri: "",
          title: r.name,
          artist: r.artist,
          coverUrl: bigImage(r.image),
          duration: r.duration ? Math.round(Number(r.duration) / 1000) : undefined,
          meta: { noPlay: true, url: r.url },
        });
      }
    }
    if (a.status === "fulfilled") {
      for (const r of a.value?.results?.albummatches?.album ?? []) {
        if (!r.name) continue;
        albums.push({
          id: r.mbid ? `lastfm:album:${r.mbid}` : `lastfm:album:${r.artist}:${r.name}`,
          provider: this.id,
          title: r.name,
          artist: r.artist,
          coverUrl: bigImage(r.image),
          meta: { url: r.url },
        } as Album);
      }
    }
    if (ar.status === "fulfilled") {
      for (const r of ar.value?.results?.artistmatches?.artist ?? []) {
        if (!r.name) continue;
        artists.push({
          id: r.mbid ? `lastfm:artist:${r.mbid}` : `lastfm:artist:${r.name}`,
          provider: this.id,
          name: r.name,
          coverUrl: bigImage(r.image),
          meta: { url: r.url },
        } as Artist);
      }
    }
    return { provider: this.id, tracks, albums, artists };
  }

  async resolveUri(_track: Track): Promise<string> {
    throw new Error("lastfm: no audio");
  }

  async getAlbum(_albumId: string): Promise<AlbumDetail> {
    throw new Error("lastfm: no album detail");
  }

  async getArtist(_artistId: string): Promise<ArtistDetail> {
    throw new Error("lastfm: no artist detail");
  }

  async getSimilarArtists(artist: string): Promise<string[]> {
    try {
      const res = await this.call<{ similarartists?: { artist?: LfmArtist[] } }>(
        "artist.getsimilar",
        artist,
      );
      return (res.similarartists?.artist ?? [])
        .map((a) => a.name)
        .filter((n): n is string => Boolean(n))
        .slice(0, 8);
    } catch {
      return [];
    }
  }

  async getSimilarTracks(artist: string, track: string): Promise<Track[]> {
    try {
      const res = await this.callWithParams<{ similartracks?: { track?: LfmTrack[] } }>(
        "track.getsimilar",
        { artist, track },
      );
      return (res.similartracks?.track ?? [])
        .map((r): Track => ({
          id: r.mbid ? `lastfm:track:${r.mbid}` : `lastfm:track:${r.artist}:${r.name}`,
          provider: this.id,
          uri: "",
          title: r.name ?? "",
          artist: r.artist,
          duration: r.duration ? Math.round(Number(r.duration) / 1000) : undefined,
          coverUrl: bigImage(r.image),
          meta: { noPlay: true, url: r.url },
        })).filter((t) => Boolean(t.title));
    } catch {
      return [];
    }
  }

  /** Топ-треки артиста (для радио, когда похожих треков мало). */
  async getArtistTopTracks(artist: string): Promise<Track[]> {
    try {
      const res = await this.callWithParams<{ toptracks?: { track?: LfmTrack[] } }>(
        "artist.gettoptracks",
        { artist },
      );
      return (res.toptracks?.track ?? [])
        .map((r): Track => ({
          id: r.mbid ? `lastfm:artist:${r.mbid}` : `lastfm:artist:${r.artist}:${r.name}`,
          provider: this.id,
          uri: "",
          title: r.name ?? "",
          artist: r.artist,
          duration: r.duration ? Math.round(Number(r.duration) / 1000) : undefined,
          coverUrl: bigImage(r.image),
          meta: { noPlay: true, url: r.url },
        })).filter((t) => Boolean(t.title));
    } catch {
      return [];
    }
  }

  private async call<T>(method: string, query: string): Promise<T> {
    const url = `${API}/?method=${method}&${method.split(".")[0]}=${encodeURIComponent(
      query,
    )}&api_key=${encodeURIComponent(this.apiKey)}&format=json&limit=20`;
    const { status, body } = await this.http.json("GET", url, undefined, {
      "Content-Type": "application/json",
    });
    if (status !== 200) throw new Error(`lastfm ${method} failed: ${status}`);
    return body as T;
  }

  private async callWithParams<T>(method: string, params: Record<string, string>): Promise<T> {
    const search = new URLSearchParams({ method, api_key: this.apiKey, format: "json", limit: "20" });
    for (const [k, v] of Object.entries(params)) {
      search.set(k, v);
    }
    const { status, body } = await this.http.json("GET", `${API}/?${search.toString()}`, undefined, {
      "Content-Type": "application/json",
    });
    if (status !== 200) throw new Error(`lastfm ${method} failed: ${status}`);
    return body as T;
  }
}
