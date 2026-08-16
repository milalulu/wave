import type { Album, Artist, SearchResults, Track } from "../types";
import type { AlbumDetail, ArtistDetail } from "../types";
import type { MusicProvider } from "./MusicProvider";
import type { HttpJsonGateway } from "./HttpGateway";

export interface SpotifyConfig {
  clientId: string;
  clientSecret: string;
  /** Ленивый поиск playable-трека на YouTube (для полноценного воспроизведения без preview). */
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
}

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const API = "https://api.spotify.com/v1";

function cover(images?: SpotifyImage[]): string | undefined {
  return images?.find((i) => i.url)?.url;
}

/**
 * Провайдер Spotify (официальный Web API, client credentials).
 * Поиск по метаданным; воспроизведение — полная версия через YouTube-fallback
 * (если настроен), иначе 30-секундные preview там, где есть.
 */
export class SpotifyProvider implements MusicProvider {
  readonly id = "spotify";
  readonly name = "Spotify";

  private token: string | null = null;
  private fallbackCache = new Map<string, string>();

  constructor(
    private http: HttpJsonGateway,
    private config: SpotifyConfig,
  ) {}

  async search(query: string): Promise<SearchResults> {
    const token = await this.accessToken();
    const url = `${API}/search?q=${encodeURIComponent(query)}&type=track,album,artist&limit=50`;
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
      tracks.push({
        id: `spotify:track:${t.id}`,
        provider: this.id,
        uri: t.preview_url ?? "",
        title: t.name,
        artist: t.artists?.[0]?.name,
        album: t.album?.name,
        coverUrl: cover(t.album?.images),
        duration: t.duration_ms ? Math.round(t.duration_ms / 1000) : undefined,
        meta: {
          spotifyUrl: t.external_urls?.spotify,
          // Метка «превью» ставится только когда полной версии (YouTube-fallback)
          // нет: иначе фильтр «не искать треки-превью» выбросит полностью
          // играбельные треки.
          ...(t.preview_url && !this.config.ytFallback ? { preview: true } : {}),
        },
      });
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
      }));
    return { provider: this.id, tracks, albums, artists };
  }

  async resolveUri(track: Track): Promise<string> {
    // Полная версия через YouTube-fallback важнее превью: трек из поиска с
    // preview_url и так считается «превью», пока полной версии нет.
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
        // YouTube-fallback упал (нет совпадения/стрим не построился) —
        // играем превью, если оно есть.
      }
    }
    if (track.uri) return track.uri;
    throw new Error("spotify: no playable source");
  }

  async getAlbum(_albumId: string): Promise<AlbumDetail> {
    throw new Error("spotify provider: no album detail yet");
  }

  async getArtist(_artistId: string): Promise<ArtistDetail> {
    throw new Error("spotify provider: no artist detail yet");
  }

  private async accessToken(): Promise<string> {
    if (this.token) return this.token;
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
    this.token = (body as { access_token?: string }).access_token ?? null;
    if (!this.token) throw new Error("spotify: no access_token");
    return this.token;
  }
}
