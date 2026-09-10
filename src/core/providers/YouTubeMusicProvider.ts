import { invoke } from "@tauri-apps/api/core";
import type { Album, Artist, SearchResults, Track } from "../types";
import type { AlbumDetail, ArtistDetail } from "../types";
import type { MusicProvider } from "./MusicProvider";
import { loadYtQuality, type YtQuality } from "../../app/ytQuality";

export interface YtSearchResult {
  id: string;
  title: string;
  uploader?: string;
  duration?: number;
  thumbnail?: string;
}

export interface YtChannelResult {
  id: string;
  name: string;
  thumbnail?: string;
  subscriberCount?: string;
}

export interface YtPlaylistResult {
  id: string;
  title: string;
  thumbnail?: string;
  trackCount?: number;
  artist?: string;
}

export interface YtFullSearchResult {
  tracks: YtSearchResult[];
  artists: YtChannelResult[];
  albums: YtPlaylistResult[];
}

export interface YtDlpGateway {
  search(query: string, limit: number): Promise<YtSearchResult[]>;
  stream(videoId: string, quality?: YtQuality): Promise<string>;
}

function cover(thumb?: string): string | undefined {
  return thumb?.replace("hq720", "mqdefault").replace("hqdefault", "mqdefault");
}

const STREAM_TTL_MS = 2 * 60 * 60 * 1000;
const SEARCH_TTL_MS = 10 * 60 * 1000;
const RELATED_TTL_MS = 30 * 60 * 1000;
// Защита от вечного зависания: yt-dlp-гейтвей на медленной сети (типично для
// Android) может не ответить никогда — движок должен получить ошибку и пойти дальше.
export const YT_RESOLVE_TIMEOUT_MS = 60 * 1000;

function withResolveTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`youtube: stream resolve timed out (${label})`)),
      YT_RESOLVE_TIMEOUT_MS,
    );
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export class YouTubeMusicProvider implements MusicProvider {
  readonly id = "youtube";
  readonly name = "YouTube Music";

  private streamCache = new Map<string, { url: string; at: number }>();
  private searchCache = new Map<string, { results: SearchResults; at: number }>();
  private relatedCache = new Map<string, { tracks: Track[]; at: number }>();

  constructor(private gateway: YtDlpGateway) {}

  // Innertube (нативный HTTP) в приоритете, yt-dlp — как фолбэк.
  private async searchEntries(query: string, limit: number): Promise<YtSearchResult[]> {
    try {
      const full = await invoke<YtFullSearchResult>("yt_search_innertube_full", {
        query,
        limit,
      });
      if (full.tracks.length > 0) return full.tracks;
    } catch {}
    try {
      return await invoke<YtSearchResult[]>("yt_search_innertube", { query, limit });
    } catch {
      return this.gateway.search(query, limit);
    }
  }

  async search(query: string): Promise<SearchResults> {
    const key = query.trim().replace(/\s+/g, " ").toLowerCase();
    const hit = this.searchCache.get(key);
    if (hit && Date.now() - hit.at < SEARCH_TTL_MS) return hit.results;

    let entries: YtSearchResult[];
    let rawArtists: YtChannelResult[] = [];
    let rawAlbums: YtPlaylistResult[] = [];
    try {
      const full = await invoke<YtFullSearchResult>("yt_search_innertube_full", {
        query,
        limit: 20,
      });
      entries = full.tracks;
      rawArtists = full.artists;
      rawAlbums = full.albums;
    } catch {
      try {
        entries = await invoke<YtSearchResult[]>("yt_search_innertube", {
          query,
          limit: 20,
        });
      } catch {
        entries = await this.gateway.search(query, 20);
      }
    }

    const tracks: Track[] = entries.map((e, i) => ({
      id: `youtube:track:${e.id}`,
      provider: this.id,
      uri: `https://www.youtube.com/watch?v=${e.id}`,
      title: e.title,
      artist: e.uploader,
      coverUrl: cover(e.thumbnail),
      duration: e.duration ?? undefined,
      meta: { ytId: e.id, searchIndex: i },
    }));

    const artists: Artist[] = rawArtists.map((a) => ({
      id: `youtube:artist:${a.id}`,
      provider: this.id,
      name: a.name,
      coverUrl: cover(a.thumbnail),
      meta: { ytChannelId: a.id, subscriberCount: a.subscriberCount },
    }));

    const albums: Album[] = rawAlbums.map((a) => ({
      id: `youtube:album:${a.id}`,
      provider: this.id,
      title: a.title,
      artist: a.artist,
      coverUrl: cover(a.thumbnail),
      trackCount: a.trackCount,
      meta: { ytPlaylistId: a.id },
    }));

    const results: SearchResults = { provider: this.id, tracks, albums, artists };
    this.searchCache.set(key, { results, at: Date.now() });
    this.prune(this.searchCache, SEARCH_TTL_MS);
    return results;
  }

  async resolveUri(track: Track): Promise<string> {
    const ytId = track.meta?.ytId as string | undefined;
    const fromId = track.id.split(":").pop();
    const id = ytId ?? fromId;
    if (!id) throw new Error("youtube: no video id");
    const quality = loadYtQuality();
    const key = `${id}:${quality}`;
    const hit = this.streamCache.get(key);
    if (hit && Date.now() - hit.at < STREAM_TTL_MS) return hit.url;

    try {
      const url = await withResolveTimeout(
        invoke<string>("yt_resolve_innertube", { videoId: id }),
        "innertube",
      );
      this.streamCache.set(key, { url, at: Date.now() });
      this.prune(this.streamCache, STREAM_TTL_MS);
      return url;
    } catch {}

    const url = await withResolveTimeout(this.gateway.stream(id, quality), "gateway");
    this.streamCache.set(key, { url, at: Date.now() });
    this.prune(this.streamCache, STREAM_TTL_MS);
    return url;
  }

  invalidateStream(trackId: string): void {
    const fromId = trackId.split(":").pop();
    if (!fromId) return;
    const quality = loadYtQuality();
    const key = `${fromId}:${quality}`;
    this.streamCache.delete(key);
  }

  private prune<K>(cache: Map<K, { at: number }>, ttl: number): void {
    if (cache.size <= 64) return;
    const now = Date.now();
    for (const [k, v] of cache) {
      if (now - v.at > ttl) cache.delete(k);
    }
    if (cache.size > 64) {
      const first = cache.keys().next().value;
      if (first !== undefined) cache.delete(first);
    }
  }

  async getAlbum(_albumId: string): Promise<AlbumDetail> {
    throw new Error("youtube provider: no albums");
  }

  /**
   * Импорт одного видео по ссылке: название/автор через oEmbed (без ключей),
   * стрим резолвится позже обычным путём.
   */
  async importVideoFromUrl(videoId: string): Promise<{ name: string; tracks: Track[] }> {
    const res = await invoke<{ status: number; body: unknown }>("http_fetch_json", {
      method: "GET",
      url: `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`,
      body: null,
      headers: [],
    });
    if (res.status !== 200 || typeof res.body !== "object" || !res.body) {
      throw new Error("youtube: oEmbed failed");
    }
    const { title, author_name } = res.body as { title?: string; author_name?: string };
    if (!title) throw new Error("youtube: no title (private/deleted?)");
    const track: Track = {
      id: `youtube:track:${videoId}`,
      provider: this.id,
      uri: `https://www.youtube.com/watch?v=${videoId}`,
      title,
      artist: author_name,
      meta: { ytId: videoId },
    };
    return { name: `${author_name ?? ""} - ${title}`.trim(), tracks: [track] };
  }

  async getArtist(_artistId: string): Promise<ArtistDetail> {
    throw new Error("youtube provider: no artists");
  }

  async getSimilarTracks(artist: string, track: string, options?: import("./MusicProvider").MoodRecommendOptions, seed?: Track): Promise<Track[]> {
    const ytId = seed?.meta?.ytId as string | undefined;
    if (ytId) {
      const hit = this.relatedCache.get(ytId);
      if (hit && Date.now() - hit.at < RELATED_TTL_MS) return hit.tracks;
      try {
        const related = await invoke<YtSearchResult[]>("yt_related_videos", { videoId: ytId, limit: 15 });
        if (related.length > 0) {
          const tracks = this.entriesToSimilar(related);
          this.relatedCache.set(ytId, { tracks, at: Date.now() });
          return tracks;
        }
      } catch {}
    }
    if (!artist) return [];
    try {
      let query: string;
      if (track && options?.moods?.length) {
        query = `${artist} ${track} ${options.moods[0]}`;
      } else if (track) {
        query = `${artist} ${track}`;
      } else if (options?.moods?.length) {
        query = `${artist} ${options.moods[0]} ${options.genres?.[0] ?? "music"}`;
      } else {
        query = `${artist} music`;
      }
      const entries = await this.searchEntries(query, 15);
      return this.entriesToSimilar(entries);
    } catch {
      return [];
    }
  }

  private entriesToSimilar(entries: YtSearchResult[]): Track[] {
    return entries
      .filter((e) => {
        const title = (e.title ?? "").toLowerCase();
        if (/type beat|typeBeat|\bfree beat\b|\bfree type\b/.test(title)) return false;
        if (e.duration && e.duration < 30) return false;
        return true;
      })
      .slice(0, 10)
      .map((e) => ({
        id: `youtube:track:${e.id}`,
        provider: this.id,
        uri: `https://www.youtube.com/watch?v=${e.id}`,
        title: e.title,
        artist: e.uploader,
        coverUrl: cover(e.thumbnail),
        duration: e.duration ?? undefined,
        meta: { ytId: e.id },
      }));
  }

  async getSimilarArtists(artist: string): Promise<string[]> {
    if (!artist) return [];
    try {
      const entries = await this.searchEntries(`${artist} similar artist`, 8);
      return entries.map((e) => e.uploader ?? "").filter((n) => n && n !== artist).slice(0, 8);
    } catch {
      return [];
    }
  }

  async getArtistTopTracks(artist: string): Promise<Track[]> {
    return this.getSimilarTracks(artist, "");
  }
}
