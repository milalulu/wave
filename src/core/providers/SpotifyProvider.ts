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
        ...(t.preview_url && !this.config.ytFallback ? { preview: true } : {}),
      },
    };
  }

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
    const { status, body } = await this.http.json(
      "GET",
      `${API}/artists/${realId}/top-tracks?market=US`,
      undefined,
      { Authorization: `Bearer ${token}` },
    );
    if (status !== 200) throw new Error(`spotify artist failed: ${status}`);
    const data = body as { tracks?: SpotifyTrack[] };
    const firstTrack = data.tracks?.[0];
    const artistName = firstTrack?.artists?.[0]?.name ?? "";
    const artistImage = firstTrack?.album?.images;
    return {
      artist: {
        id: artistId,
        provider: this.id,
        name: artistName,
        coverUrl: cover(artistImage),
      },
      topTracks: (data.tracks ?? [])
        .filter((t) => t?.id && t.name)
        .map((t) => this.toTrack(t)),
      albums: [],
    };
  }

  async getSimilarTracks(artist: string, track: string): Promise<Track[]> {
    const cacheKey = `${artist}|${track}`;
    const hit = this.similarCache.get(cacheKey);
    if (hit && Date.now() - hit.at < SpotifyProvider.SIMILAR_TTL_MS) return hit.tracks;
    try {
      const token = await this.accessToken();
      const params = new URLSearchParams({ market: "US", limit: "20" });
      if (track) {
        const trackId = await this.findTrackId(track, artist, token);
        if (trackId) params.set("seed_tracks", trackId);
      } else if (artist) {
        const artistId = await this.findArtistId(artist, token);
        if (artistId) params.set("seed_artists", artistId);
      }
      const { status, body } = await this.http.json(
        "GET",
        `${API}/recommendations?${params.toString()}`,
        undefined,
        { Authorization: `Bearer ${token}` },
      );
      if (status !== 200) return [];
      const data = body as { tracks?: SpotifyTrack[] };
      const tracks = (data.tracks ?? [])
        .filter((t) => t?.id && t.name)
        .map((t) => this.toTrack(t));
      this.similarCache.set(cacheKey, { tracks, at: Date.now() });
      return tracks;
    } catch {
      return [];
    }
  }

  async getSimilarArtists(artist: string): Promise<string[]> {
    const hit = this.similarArtistsCache.get(artist);
    if (hit && Date.now() - hit.at < SpotifyProvider.SIMILAR_TTL_MS) return hit.names;
    try {
      const token = await this.accessToken();
      const artistId = await this.findArtistId(artist, token);
      if (!artistId) return [];
      const { status, body } = await this.http.json(
        "GET",
        `${API}/artists/${artistId}/related-artists?limit=10`,
        undefined,
        { Authorization: `Bearer ${token}` },
      );
      if (status !== 200) return [];
      const data = body as { artists?: SpotifyArtist[] };
      const names = (data.artists ?? [])
        .map((a) => a.name ?? "")
        .filter((n) => n && n !== artist)
        .slice(0, 8);
      this.similarArtistsCache.set(artist, { names, at: Date.now() });
      return names;
    } catch {
      return [];
    }
  }

  async getArtistTopTracks(artist: string): Promise<Track[]> {
    try {
      const token = await this.accessToken();
      const artistId = await this.findArtistId(artist, token);
      if (!artistId) return [];
      const { status, body } = await this.http.json(
        "GET",
        `${API}/artists/${artistId}/top-tracks?market=US`,
        undefined,
        { Authorization: `Bearer ${token}` },
      );
      if (status !== 200) return [];
      const data = body as { tracks?: SpotifyTrack[] };
      return (data.tracks ?? [])
        .filter((t) => t?.id && t.name)
        .slice(0, 10)
        .map((t) => this.toTrack(t));
    } catch {
      return [];
    }
  }

  private async findTrackId(title: string, artist: string, token: string): Promise<string | null> {
    try {
      const q = `track:${title} artist:${artist}`;
      const { status, body } = await this.http.json(
        "GET",
        `${API}/search?q=${encodeURIComponent(q)}&type=track&limit=1`,
        undefined,
        { Authorization: `Bearer ${token}` },
      );
      if (status !== 200) return null;
      const data = body as { tracks?: { items?: SpotifyTrack[] } };
      return data.tracks?.items?.[0]?.id ?? null;
    } catch {
      return null;
    }
  }

  private async findArtistId(name: string, token: string): Promise<string | null> {
    try {
      const { status, body } = await this.http.json(
        "GET",
        `${API}/search?q=${encodeURIComponent(name)}&type=artist&limit=1`,
        undefined,
        { Authorization: `Bearer ${token}` },
      );
      if (status !== 200) return null;
      const data = body as { artists?: { items?: SpotifyArtist[] } };
      return data.artists?.items?.[0]?.id ?? null;
    } catch {
      return null;
    }
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
