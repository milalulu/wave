import type { AlbumDetail, ArtistDetail, SearchResults, Track } from "../types";

/** Единая абстракция музыкального источника. Проект не привязан к одному провайдеру. */
export interface MusicProvider {
  readonly id: string;
  readonly name: string;
  search(query: string): Promise<SearchResults>;
  resolveUri(track: Track): Promise<string>;
  getAlbum(albumId: string): Promise<AlbumDetail>;
  getArtist(artistId: string): Promise<ArtistDetail>;
  /** Опционально: имена похожих исполнителей (Last.fm). */
  getSimilarArtists?(artist: string): Promise<string[]>;
  /** Опционально: треки похожие на указанный (Last.fm). */
  getSimilarTracks?(artist: string, track: string): Promise<Track[]>;
  /** Опционально: топ-треки артиста (для радио). */
  getArtistTopTracks?(artist: string): Promise<Track[]>;
}