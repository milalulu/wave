import type { Album, Artist, HistoryEntry, Playlist, Track } from "../types";

export interface QueueState {
  tracks: Track[];
  index: number;
  position: number;
}

export interface Storage {
  init(): Promise<void>;
  isLiked(trackId: string): Promise<boolean>;
  isAlbumSaved(albumId: string): Promise<boolean>;
  isArtistSaved(artistId: string): Promise<boolean>;
  getLikedTracks(): Promise<Track[]>;
  addLikedTrack(track: Track): Promise<void>;
  removeLikedTrack(trackId: string): Promise<void>;
  getSavedAlbums(): Promise<Album[]>;
  addSavedAlbum(album: Album): Promise<void>;
  removeSavedAlbum(albumId: string): Promise<void>;
  getSavedArtists(): Promise<Artist[]>;
  addSavedArtist(artist: Artist): Promise<void>;
  removeSavedArtist(artistId: string): Promise<void>;
  getHistory(limit?: number): Promise<HistoryEntry[]>;
  addHistoryEntry(entry: HistoryEntry): Promise<void>;
  clearHistory(): Promise<void>;
  getPlaylists(): Promise<Playlist[]>;
  getPlaylist(id: string): Promise<Playlist | null>;
  addPlaylist(playlist: Playlist): Promise<void>;
  updatePlaylist(playlist: Playlist): Promise<void>;
  removePlaylist(id: string): Promise<void>;
  saveQueueState(state: QueueState): Promise<void>;
  loadQueueState(): Promise<QueueState | null>;
}
