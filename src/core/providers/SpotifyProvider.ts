import type { Album, Artist, SearchResults, Track } from "../types";
import type { AlbumDetail, ArtistDetail } from "../types";
import type { MusicProvider } from "./MusicProvider";
import type { HttpJsonGateway } from "./HttpGateway";

export interface SpotifyConfig {
  clientId: string;
  clientSecret: string;
  
  ytFallback?: (artist: string, title: string) => Promise<string>;
}

interface SpotifyImage {
  url?: string;
}

interface SpotifyTrack {
  id: string;
  name?: string;
  artists?: { name?: string }[];
  album?: { name?: string; images?: SpotifyImage[] };
  duration_ms?: number;
  preview_url?: string;
  popularity?: number;
  external_urls?: { spotify?: string };
}

interface SpotifyAlbum {
  id: string;
  name?: string;
  artists?: { name?: string }[];
  images?: SpotifyImage[];
  release_date?: string;
  total_tracks?: number;
}

interface SpotifyArtist {
  id: string;
  name?: string;
  images?: SpotifyImage[];
  popularity?: number;
  followers?: { total?: number };
}

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const API = "https://api.spotify.com/v1";

function cover(images?: SpotifyImage[]): string | undefined {
  return images?.find((i) => i.url)?.url;
}

function normKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9а-яё]+/gi, " ").replace(/\s+/g, " ").trim();
}

export class SpotifyProvider implements MusicProvider {
  readonly id = "spotify";
  readonly name = "Spotify";

  private token: string | null = null;
  private tokenExpiresAt = 0;
  private fallbackCache = new Map<string, string>();
  private similarCache = new Map<string, { tracks: Track[]; at: number }>();
  private similarArtistsCache = new Map<string, { names: string[]; at: number }>();
  private static readonly SIMILAR_TTL_MS = 10 * 60 * 1000;

  constructor(
    private http: HttpJsonGateway,
    private config: SpotifyConfig,
  ) {}

  private toTrack(t: SpotifyTrack, albumName?: string, albumImages?: SpotifyImage[]): Track {
    return {
      id: `spotify:track:${t.id}`,
      provider: this.id,
      uri: t.preview_url ?? "",
      title: t.name ?? "",
      artist: t.artists?.[0]?.name,
      album: albumName ?? t.album?.name,
      coverUrl: cover(albumImages ?? t.album?.images),
      duration: t.duration_ms ? Math.round(t.duration_ms / 1000) : undefined,
      meta: {
        spotifyUrl: t.external_urls?.spotify,
        ...(typeof t.popularity === "number" ? { popularity: t.popularity } : {}),
        ...(t.preview_url && !this.config.ytFallback ? { preview: true } : {}),
      },
    };
  }

  async search(query: string): Promise<SearchResults> {
    const token = await this.accessToken();
    // С февраля 2026 лимит поиска урезан до 10 (dev-режим).
    const url = `${API}/search?q=${encodeURIComponent(query)}&type=track,album,artist&limit=10`;
    const { status, body } = await this.http.json("GET", url, undefined, {
      Authorization: `Bearer ${token}`,
    });
    if (status !== 200) throw new Error(`spotify search failed: ${status}`);
    const data = body as {
      tracks?: { items?: SpotifyTrack[] };
      albums?: { items?: SpotifyAlbum[] };
      artists?: { items?: SpotifyArtist[] };
    };
    const tracks: Track[] = [];
    for (const t of data.tracks?.items ?? []) {
      if (!t.id || !t.name) continue;
      tracks.push(this.toTrack(t));
    }
    const albums: Album[] = (data.albums?.items ?? [])
      .filter((a) => a?.id && a.name)
      .map((a) => ({
        id: `spotify:album:${a.id}`,
        provider: this.id,
        title: a.name ?? "",
        artist: a.artists?.[0]?.name,
        coverUrl: cover(a.images),
        year: a.release_date ? new Date(a.release_date).getFullYear() : undefined,
        trackCount: a.total_tracks,
      }));
    const artists: Artist[] = (data.artists?.items ?? [])
      .filter((a) => a?.id && a.name)
      .map((a) => ({
        id: `spotify:artist:${a.id}`,
        provider: this.id,
        name: a.name ?? "",
        coverUrl: cover(a.images),
        meta: {
          ...(typeof a.popularity === "number" ? { popularity: a.popularity } : {}),
          ...(typeof a.followers?.total === "number" ? { followers: a.followers.total } : {}),
        },
      }));
    return { provider: this.id, tracks, albums, artists };
  }

  async resolveUri(track: Track): Promise<string> {
    
    
    if (this.config.ytFallback) {
      const artist = track.artist ?? "";
      const title = track.title ?? "";
      const cacheKey = `${artist}|${title}`;
      const cached = this.fallbackCache.get(cacheKey);
      if (cached) return cached;
      try {
        const uri = await this.config.ytFallback(artist, title);
        this.fallbackCache.set(cacheKey, uri);
        return uri;
      } catch {
        
        
      }
    }
    if (track.uri) return track.uri;
    throw new Error("spotify: no playable source");
  }

  async getAlbum(albumId: string): Promise<AlbumDetail> {
    const realId = albumId.replace(/^spotify:album:/, "");
    const token = await this.accessToken();
    const { status, body } = await this.http.json(
      "GET",
      `${API}/albums/${realId}`,
      undefined,
      { Authorization: `Bearer ${token}` },
    );
    if (status !== 200) throw new Error(`spotify album failed: ${status}`);
    const a = body as SpotifyAlbum & { tracks?: { items?: SpotifyTrack[] } };
    return {
      album: {
        id: albumId,
        provider: this.id,
        title: a.name ?? "",
        artist: a.artists?.[0]?.name,
        coverUrl: cover(a.images),
        year: a.release_date ? new Date(a.release_date).getFullYear() : undefined,
        trackCount: a.total_tracks,
      },
      tracks: (a.tracks?.items ?? [])
        .filter((t) => t?.id && t.name)
        .map((t) => this.toTrack(t, a.name, a.images)),
    };
  }

  async getArtist(artistId: string): Promise<ArtistDetail> {
    const realId = artistId.replace(/^spotify:artist:/, "");
    const token = await this.accessToken();
    // GET /artists/{id}/top-tracks удалён в феврале 2026: берём сингл артиста
    // (имя/обложка) + топ через обычный поиск по исполнителю.
    const { status, body } = await this.http.json(
      "GET",
      `${API}/artists/${realId}`,
      undefined,
      { Authorization: `Bearer ${token}` },
    );
    if (status !== 200) throw new Error(`spotify artist failed: ${status}`);
    const a = body as SpotifyArtist;
    const artistName = a.name ?? "";
    const topTracks = artistName ? await this.getArtistTopTracks(artistName) : [];
    return {
      artist: {
        id: artistId,
        provider: this.id,
        name: artistName,
        coverUrl: cover(a.images),
      },
      topTracks,
      albums: [],
    };
  }

  async getSimilarTracks(artist: string, track: string, options?: import("./MusicProvider").MoodRecommendOptions): Promise<Track[]> {
    const cacheKey = `${artist}|${track}|${JSON.stringify(options ?? {})}`;
    const hit = this.similarCache.get(cacheKey);
    if (hit && Date.now() - hit.at < SpotifyProvider.SIMILAR_TTL_MS) return hit.tracks;
    // /recommendations заблокирован для dev-приложений с ноября 2024:
    // похожесть собираем текстовым поиском (артист + жанры/настроения).
    try {
      const token = await this.accessToken();
      const queries: string[] = [];
      if (artist) queries.push(`artist:${artist}`);
      const moodTerms = [...(options?.genres ?? []), ...(options?.moods ?? [])].slice(0, 2);
      if (moodTerms.length > 0) queries.push(moodTerms.join(" "));
      if (queries.length === 0) return [];
      const settled = await Promise.allSettled(
        queries.map((q) =>
          this.http.json(
            "GET",
            `${API}/search?q=${encodeURIComponent(q)}&type=track&limit=10`,
            undefined,
            { Authorization: `Bearer ${token}` },
          ),
        ),
      );
      const seen = new Set<string>();
      const tracks: Track[] = [];
      const seedKey = `${normKey(artist)}|${normKey(track)}`;
      for (const r of settled) {
        if (r.status !== "fulfilled" || r.value.status !== 200) continue;
        const data = r.value.body as { tracks?: { items?: SpotifyTrack[] } };
        for (const t of data.tracks?.items ?? []) {
          if (!t?.id || !t.name || seen.has(t.id)) continue;
          seen.add(t.id);
          if (`${normKey(t.artists?.[0]?.name ?? "")}|${normKey(t.name)}` === seedKey) continue;
          tracks.push(this.toTrack(t));
          if (tracks.length >= 15) break;
        }
        if (tracks.length >= 15) break;
      }
      this.similarCache.set(cacheKey, { tracks, at: Date.now() });
      return tracks;
    } catch {
      return [];
    }
  }

  async getSimilarArtists(artist: string): Promise<string[]> {
    const hit = this.similarArtistsCache.get(artist);
    if (hit && Date.now() - hit.at < SpotifyProvider.SIMILAR_TTL_MS) return hit.names;
    // /related-artists заблокирован для dev-приложений: выводим похожих
    // исполнителей из похожих треков.
    try {
      const tracks = await this.getSimilarTracks(artist, "");
      const names = new Set<string>();
      for (const t of tracks) {
        if (t.artist && t.artist !== artist) names.add(t.artist);
        if (names.size >= 8) break;
      }
      const out = [...names];
      this.similarArtistsCache.set(artist, { names: out, at: Date.now() });
      return out;
    } catch {
      return [];
    }
  }

  async getArtistTopTracks(artist: string): Promise<Track[]> {
    // /artists/{id}/top-tracks удалён: топ — это первые результаты поиска по артисту.
    try {
      const token = await this.accessToken();
      const { status, body } = await this.http.json(
        "GET",
        `${API}/search?q=${encodeURIComponent(`artist:${artist}`)}&type=track&limit=10`,
        undefined,
        { Authorization: `Bearer ${token}` },
      );
      if (status !== 200) return [];
      const data = body as { tracks?: { items?: SpotifyTrack[] } };
      return (data.tracks?.items ?? [])
        .filter((t) => t?.id && t.name)
        .slice(0, 10)
        .map((t) => this.toTrack(t));
    } catch {
      return [];
    }
  }

  /**
   * Импорт по ссылке open.spotify.com: трек/альбом/плейлист → {name, tracks}.
   * Использует только живые сингл-эндпоинты (см. комменты выше).
   */
  async importFromUrl(kind: "track" | "album" | "playlist", id: string): Promise<{ name: string; tracks: Track[] }> {
    const token = await this.accessToken();
    const auth = { Authorization: `Bearer ${token}` };
    if (kind === "track") {
      const { status, body } = await this.http.json("GET", `${API}/tracks/${id}`, undefined, auth);
      if (status !== 200) throw new Error(`spotify track failed: ${status}`);
      const t = body as SpotifyTrack;
      if (!t?.id || !t.name) throw new Error("spotify: bad track object");
      const track = this.toTrack(t);
      return { name: `${track.artist ?? ""} - ${track.title}`.trim(), tracks: [track] };
    }
    if (kind === "album") {
      const detail = await this.getAlbum(`spotify:album:${id}`);
      return { name: detail.album.title, tracks: detail.tracks };
    }
    const { status, body } = await this.http.json(
      "GET",
      `${API}/playlists/${id}?fields=name,tracks.items(track(id,name,artists(name),album(name,images),duration_ms,preview_url,external_urls))&limit=100`,
      undefined,
      auth,
    );
    if (status !== 200) throw new Error(`spotify playlist failed: ${status}`);
    const data = body as {
      name?: string;
      tracks?: { items?: { track?: SpotifyTrack | null }[] };
    };
    const tracks = (data.tracks?.items ?? [])
      .map((i) => i?.track)
      .filter((t): t is SpotifyTrack => Boolean(t?.id && t?.name))
      .map((t) => this.toTrack(t));
    if (tracks.length === 0) throw new Error("spotify: empty playlist (private?)");
    return { name: data.name ?? "Spotify playlist", tracks };
  }

  private async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiresAt) return this.token;
    const auth = `Basic ${btoa(`${this.config.clientId}:${this.config.clientSecret}`)}`;
    const { status, body } = await this.http.json(
      "POST",
      TOKEN_URL,
      { grant_type: "client_credentials" },
      {
        Authorization: auth,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    );
    if (status !== 200) throw new Error(`spotify token failed: ${status}`);
    const data = body as { access_token?: string; expires_in?: number };
    this.token = data.access_token ?? null;
    if (!this.token) throw new Error("spotify: no access_token");
    const expiresIn = data.expires_in ?? 3600;
    this.tokenExpiresAt = Date.now() + (expiresIn - 60) * 1000;
    return this.token;
  }
}
