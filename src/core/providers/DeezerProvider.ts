import type { Album, Artist, SearchResults, Track } from "../types";
import type { AlbumDetail, ArtistDetail } from "../types";
import type { MusicProvider } from "./MusicProvider";
import type { HttpJsonGateway } from "./HttpGateway";

const API = "https://api.deezer.com";

interface DzArtist {
  id?: number;
  name?: string;
  picture_medium?: string;
}

interface DzAlbum {
  id?: number;
  title?: string;
  cover_medium?: string;
  cover_xl?: string;
  nb_tracks?: number;
  release_date?: string;
  artist?: DzArtist;
}

interface DzTrack {
  id: number;
  title?: string;
  artist?: DzArtist;
  album?: DzAlbum;
  duration?: number;
  preview?: string;
}

export class DeezerProvider implements MusicProvider {
  readonly id = "deezer";
  readonly name = "Deezer";

  constructor(private http: HttpJsonGateway) {}

  private resolveCache = new Map<string, { url: string; at: number }>();
  private similarCache = new Map<string, { tracks: Track[]; at: number }>();
  private static readonly CACHE_TTL_MS = 10 * 60 * 1000;

  async search(query: string): Promise<SearchResults> {
    const q = encodeURIComponent(query);
    const [tracks, albums, artists] = await Promise.all([
      this.fetchList<DzTrack>(`${API}/search?q=${q}&limit=20`),
      this.fetchList<DzAlbum>(`${API}/search/album?q=${q}&limit=12`),
      this.fetchList<DzArtist>(`${API}/search/artist?q=${q}&limit=12`),
    ]);
    return {
      provider: this.id,
      tracks: tracks.map((t) => this.track(t)).filter((t): t is Track => t !== null),
      albums: albums.map((a) => this.album(a)).filter((a): a is Album => a !== null),
      artists: artists.map((a) => this.artist(a)).filter((a): a is Artist => a !== null),
    };
  }

  async resolveUri(track: Track): Promise<string> {
    const cached = this.resolveCache.get(track.id);
    if (cached && Date.now() - cached.at < DeezerProvider.CACHE_TTL_MS) {
      return cached.url;
    }
    try {
      const id = track.id.split(":").pop() ?? "";
      const { status, body } = await this.http.json("GET", `${API}/track/${id}`, undefined, {
        "Content-Type": "application/json",
      });
      if (status === 200) {
        const preview = (body as { preview?: string }).preview;
        if (preview) {
          this.resolveCache.set(track.id, { url: preview, at: Date.now() });
          return preview;
        }
      }
    } catch {
      
    }
    return track.uri;
  }

  async getAlbum(albumIdValue: string): Promise<AlbumDetail> {
    const id = Number(albumIdValue.split(":").pop());
    const { body } = await this.http.json("GET", `${API}/album/${id}`, undefined, {
      "Content-Type": "application/json",
    });
    const a = body as DzAlbum & { tracks?: { data?: DzTrack[] } };
    const album = this.album(a);
    if (!album) throw new Error(`deezer album not found: ${albumIdValue}`);
    const tracks = (a.tracks?.data ?? [])
      .map((t) => this.track(t))
      .filter((t): t is Track => t !== null);
    return { album, tracks };
  }

  async getArtist(artistIdValue: string): Promise<ArtistDetail> {
    const id = Number(artistIdValue.split(":").pop());
    const { body } = await this.http.json("GET", `${API}/artist/${id}`, undefined, {
      "Content-Type": "application/json",
    });
    const a = body as DzArtist & { nb_album?: number };
    const artist = this.artist(a);
    if (!artist) throw new Error(`deezer artist not found: ${artistIdValue}`);
    const topTracks = await this.getArtistTopTracks(a.name ?? "");
    return { artist, topTracks, albums: [] };
  }

  async getSimilarTracks(artist: string, track: string, options?: import("./MusicProvider").MoodRecommendOptions): Promise<Track[]> {
    const cacheKey = `${artist}|${track}|${options?.moods?.join(",") ?? ""}`;
    const hit = this.similarCache.get(cacheKey);
    if (hit && Date.now() - hit.at < DeezerProvider.CACHE_TTL_MS) return hit.tracks;
    try {
      const trackId = await this.findTrackId(artist, track);
      if (!trackId) return this.fallbackSearch(artist, options);
      const { status, body } = await this.http.json(
        "GET",
        `${API}/track/${trackId}/related`,
        undefined,
        { "Content-Type": "application/json" },
      );
      if (status !== 200) return this.fallbackSearch(artist, options);
      const data = (body as { data?: DzTrack[] }).data ?? [];
      const tracks = data.map((t) => this.track(t)).filter((t): t is Track => t !== null);
      if (tracks.length >= 3) {
        this.similarCache.set(cacheKey, { tracks, at: Date.now() });
        return tracks;
      }
      const extra = await this.fallbackSearch(artist, options);
      const merged = [...tracks, ...extra];
      this.similarCache.set(cacheKey, { tracks: merged, at: Date.now() });
      return merged;
    } catch {
      return this.fallbackSearch(artist, options);
    }
  }

  private async fallbackSearch(artist: string, options?: import("./MusicProvider").MoodRecommendOptions): Promise<Track[]> {
    const mood = options?.moods?.[0] ?? "";
    const query = `${artist} ${mood}`.trim();
    try {
      const { status, body } = await this.http.json(
        "GET",
        `${API}/search?q=${encodeURIComponent(query)}&limit=10`,
        undefined,
        { "Content-Type": "application/json" },
      );
      if (status !== 200) return [];
      const data = (body as { data?: DzTrack[] }).data ?? [];
      return data.map((t) => this.track(t)).filter((t): t is Track => t !== null);
    } catch {
      return [];
    }
  }

  async getSimilarArtists(artist: string): Promise<string[]> {
    try {
      const artistId = await this.findArtistId(artist);
      if (!artistId) return [];
      const { status, body } = await this.http.json(
        "GET",
        `${API}/artist/${artistId}/related`,
        undefined,
        { "Content-Type": "application/json" },
      );
      if (status !== 200) return [];
      const data = (body as { data?: DzArtist[] }).data ?? [];
      return data.map((a) => a.name ?? "").filter((n) => n && n !== artist).slice(0, 8);
    } catch {
      return [];
    }
  }

  async getArtistTopTracks(artist: string): Promise<Track[]> {
    try {
      const artistId = await this.findArtistId(artist);
      if (!artistId) return [];
      const { status, body } = await this.http.json(
        "GET",
        `${API}/artist/${artistId}/top?limit=10`,
        undefined,
        { "Content-Type": "application/json" },
      );
      if (status !== 200) return [];
      const data = (body as { data?: DzTrack[] }).data ?? [];
      return data.map((t) => this.track(t)).filter((t): t is Track => t !== null);
    } catch {
      return [];
    }
  }

  private async findTrackId(artist: string, track: string): Promise<number | null> {
    try {
      const q = encodeURIComponent(`${artist} ${track}`);
      const { status, body } = await this.http.json(
        "GET",
        `${API}/search?q=${q}&limit=1`,
        undefined,
        { "Content-Type": "application/json" },
      );
      if (status !== 200) return null;
      const data = (body as { data?: DzTrack[] }).data ?? [];
      return data[0]?.id ?? null;
    } catch {
      return null;
    }
  }

  private async findArtistId(name: string): Promise<number | null> {
    try {
      const q = encodeURIComponent(name);
      const { status, body } = await this.http.json(
        "GET",
        `${API}/search/artist?q=${q}&limit=1`,
        undefined,
        { "Content-Type": "application/json" },
      );
      if (status !== 200) return null;
      const data = (body as { data?: DzArtist[] }).data ?? [];
      return data[0]?.id ?? null;
    } catch {
      return null;
    }
  }

  private track(t: DzTrack): Track | null {
    if (!t.id || !t.title || !t.preview) return null;
    return {
      id: `deezer:track:${t.id}`,
      provider: this.id,
      uri: t.preview,
      title: t.title,
      artist: t.artist?.name,
      album: t.album?.title,
      albumArtist: t.album?.artist?.name,
      coverUrl: t.album?.cover_medium,
      duration: t.duration,
      meta: { preview: true },
    };
  }

  private album(a: DzAlbum): Album | null {
    if (!a.id || !a.title) return null;
    return {
      id: `deezer:album:${a.id}`,
      provider: this.id,
      title: a.title,
      artist: a.artist?.name,
      coverUrl: a.cover_xl ?? a.cover_medium,
      year: a.release_date ? new Date(a.release_date).getFullYear() : undefined,
      trackCount: a.nb_tracks,
    };
  }

  private artist(a: DzArtist): Artist | null {
    if (!a.id || !a.name) return null;
    return {
      id: `deezer:artist:${a.id}`,
      provider: this.id,
      name: a.name,
      coverUrl: a.picture_medium,
    };
  }

  private async fetchList<T>(url: string): Promise<T[]> {
    const { status, body } = await this.http.json("GET", url, undefined, {
      "Content-Type": "application/json",
    });
    if (status !== 200) throw new Error(`deezer failed: ${status}`);
    return (body as { data?: T[] }).data ?? [];
  }
}
