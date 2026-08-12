import type { SearchResults, Track } from "../types";
import type { AlbumDetail, ArtistDetail } from "../types";
import type { MusicProvider } from "./MusicProvider";

export interface YtSearchResult {
  id: string;
  title: string;
  uploader?: string;
  duration?: number;
  thumbnail?: string;
}

/** Платформенный запуск yt-dlp (инжектируется из приложения). */
export interface YtDlpGateway {
  search(query: string, limit: number): Promise<YtSearchResult[]>;
  stream(videoId: string): Promise<string>;
}

function cover(thumb?: string): string | undefined {
  return thumb?.replace("hq720", "mqdefault").replace("hqdefault", "mqdefault");
}

/**
 * Провайдер YouTube/YouTube Music: поиск и поток через yt-dlp.
 * uri трека — watch-URL, реальный аудио-поток разрешается лениво
 * в resolveUri (движок вызывает его перед загрузкой).
 */
export class YouTubeMusicProvider implements MusicProvider {
  readonly id = "youtube";
  readonly name = "YouTube Music";

  constructor(private gateway: YtDlpGateway) {}

  async search(query: string): Promise<SearchResults> {
    const entries = await this.gateway.search(query, 20);
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
    return { provider: this.id, tracks, albums: [], artists: [] };
  }

  async resolveUri(track: Track): Promise<string> {
    const ytId = track.meta?.ytId as string | undefined;
    const fromId = track.id.split(":").pop();
    const id = ytId ?? fromId;
    if (!id) throw new Error("youtube: no video id");
    return this.gateway.stream(id);
  }

  async getAlbum(_albumId: string): Promise<AlbumDetail> {
    throw new Error("youtube provider: no albums");
  }

  async getArtist(_artistId: string): Promise<ArtistDetail> {
    throw new Error("youtube provider: no artists");
  }
}
