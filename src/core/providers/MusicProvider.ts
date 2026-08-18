import type { AlbumDetail, ArtistDetail, SearchResults, Track } from "../types";

export interface MoodRecommendOptions {
  moods?: string[];
  genres?: string[];
  targetEnergy?: number;
  targetValence?: number;
  targetAcousticness?: number;
}

export interface MusicProvider {
  readonly id: string;
  readonly name: string;
  search(query: string): Promise<SearchResults>;
  resolveUri(track: Track): Promise<string>;
  invalidateStream?(trackId: string): void;
  getAlbum(albumId: string): Promise<AlbumDetail>;
  getArtist(artistId: string): Promise<ArtistDetail>;
  
  getSimilarArtists?(artist: string): Promise<string[]>;
  
  getSimilarTracks?(artist: string, track: string, options?: MoodRecommendOptions): Promise<Track[]>;
  
  getArtistTopTracks?(artist: string): Promise<Track[]>;
}