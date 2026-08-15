import type { SearchResults, Track } from "../types";
import type { AlbumDetail, ArtistDetail } from "../types";
import type { MusicProvider } from "./MusicProvider";
import { localPathFromUri } from "../library/m3u";

export interface LocalFileMeta {
  path: string;
  title?: string;
  artist?: string;
  album?: string;
  duration?: number;
  cover?: string;
}

/** Платформенная часть локальных файлов (инжектируется из приложения). */
export interface LocalSource {
  pickDirectory(): Promise<string | null>;
  listMusicFiles(dir: string): Promise<LocalFileMeta[]>;
  toUri(path: string): string;
  /** SAF-выбор аудиофайлов (Android): возвращает playable asset-URLs. */
  pickAudioFiles?(): Promise<string[]>;
}

/**
 * Локальный провайдер: файлы с диска через диалог выбора папки.
 * uri трека — уже playable asset-URL (преобразует LocalSource.toUri).
 */
export class LocalProvider implements MusicProvider {
  readonly id = "local";
  readonly name = "Локальные файлы";

  private dir: string | null = null;
  private tracks: Track[] = [];

  constructor(private source: LocalSource) {}

  get directory(): string | null {
    return this.dir;
  }

  async openDirectory(): Promise<Track[]> {
    if (this.source.pickAudioFiles) {
      const urls = await this.source.pickAudioFiles();
      if (urls.length === 0) return [];
      this.dir = "__saf__";
      this.tracks = urls.map((url, i) => this.toTrackFromUrl(url, i));
      return [...this.tracks];
    }
    const dir = await this.source.pickDirectory();
    if (!dir) return [];
    this.dir = dir;
    const files = await this.source.listMusicFiles(dir);
    this.tracks = files.map((f, i) => this.toTrack(f, i));
    return [...this.tracks];
  }

  async search(query: string): Promise<SearchResults> {
    const q = query.toLowerCase();
    const tracks = this.tracks.filter(
      (t) =>
        t.title.toLowerCase().includes(q) || (t.artist ?? "").toLowerCase().includes(q),
    );
    return { provider: this.id, tracks, albums: [], artists: [] };
  }

  async resolveUri(track: Track): Promise<string> {
    return track.uri;
  }

  async getAlbum(_albumId: string): Promise<AlbumDetail> {
    throw new Error("local provider: no albums");
  }

  async getArtist(_artistId: string): Promise<ArtistDetail> {
    throw new Error("local provider: no artists");
  }

  private toTrack(file: LocalFileMeta, index: number): Track {
    const fallbackTitle = file.path.split("/").pop()?.replace(/\.[^.]+$/, "") ?? file.path;
    return {
      id: `local:${index}:${file.path}`,
      provider: this.id,
      uri: this.source.toUri(file.path),
      title: file.title ?? fallbackTitle,
      artist: file.artist,
      album: file.album,
      duration: file.duration,
      coverUrl: file.cover,
      meta: { path: file.path },
    };
  }

  private toTrackFromUrl(url: string, index: number): Track {
    const path = localPathFromUri(url) ?? url;
    const filename = path.split(/[\\/]/).filter(Boolean).pop() ?? "track";
    const fallbackTitle = filename.replace(/\.[^.]+$/, "") || filename;
    return {
      id: `local:${index}:${url}`,
      provider: this.id,
      uri: url,
      title: fallbackTitle,
      meta: { path: url },
    };
  }
}
