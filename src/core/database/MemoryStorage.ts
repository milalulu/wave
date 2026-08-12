import type { Album, Artist, HistoryEntry, Playlist, Track } from "../types";
import type { Storage } from "./Storage";

export class MemoryStorage implements Storage {
  private liked = new Map<string, Track>();
  private albums = new Map<string, Album>();
  private artists = new Map<string, Artist>();
  private history: HistoryEntry[] = [];
  private playlists = new Map<string, Playlist>();

  async init(): Promise<void> {}

  async isLiked(trackId: string): Promise<boolean> {
    return this.liked.has(trackId);
  }

  async getLikedTracks(): Promise<Track[]> {
    return [...this.liked.values()];
  }

  async addLikedTrack(track: Track): Promise<void> {
    this.liked.set(track.id, track);
  }

  async removeLikedTrack(trackId: string): Promise<void> {
    this.liked.delete(trackId);
  }

  async getSavedAlbums(): Promise<Album[]> {
    return [...this.albums.values()];
  }

  async addSavedAlbum(album: Album): Promise<void> {
    this.albums.set(album.id, album);
  }

  async removeSavedAlbum(albumId: string): Promise<void> {
    this.albums.delete(albumId);
  }

  async getSavedArtists(): Promise<Artist[]> {
    return [...this.artists.values()];
  }

  async addSavedArtist(artist: Artist): Promise<void> {
    this.artists.set(artist.id, artist);
  }

  async removeSavedArtist(artistId: string): Promise<void> {
    this.artists.delete(artistId);
  }

  async getHistory(limit?: number): Promise<HistoryEntry[]> {
    const reversed = [...this.history].reverse();
    return limit ? reversed.slice(0, limit) : reversed;
  }

  async addHistoryEntry(entry: HistoryEntry): Promise<void> {
    this.history.push(entry);
  }

  async clearHistory(): Promise<void> {
    this.history = [];
  }

  async getPlaylists(): Promise<Playlist[]> {
    return [...this.playlists.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async getPlaylist(id: string): Promise<Playlist | null> {
    return this.playlists.get(id) ?? null;
  }

  async addPlaylist(playlist: Playlist): Promise<void> {
    this.playlists.set(playlist.id, playlist);
  }

  async updatePlaylist(playlist: Playlist): Promise<void> {
    this.playlists.set(playlist.id, playlist);
  }

  async removePlaylist(id: string): Promise<void> {
    this.playlists.delete(id);
  }
}
