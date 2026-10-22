import type { Storage, QueueState } from "../database/Storage";
import type { Album, Artist, HistoryEntry, Playlist, Track } from "../types";
import { RecordingCatalog, type RecordingGroup } from "./RecordingCatalog";

/** Projects legacy source IDs into recording IDs without rewriting user history. */
export class RecordingStorage implements Storage {
  constructor(private base: Storage, readonly recordings: RecordingCatalog) {}
  init(): Promise<void> { return this.base.init(); }
  loadRecordingGroups(): Promise<RecordingGroup[]> { return this.base.loadRecordingGroups(); }
  saveRecordingGroups(groups: RecordingGroup[]): Promise<void> { return this.base.saveRecordingGroups(groups); }
  async isLiked(id: string): Promise<boolean> {
    return (await Promise.all(this.recordings.aliases(id).map((alias) => this.base.isLiked(alias)))).some(Boolean);
  }
  async getLikedTracks(): Promise<Track[]> {
    const tracks = (await this.base.getLikedTracks()).map((t) => this.recordings.resolve(t));
    return [...new Map(tracks.map((t) => [t.id, t])).values()];
  }
  addLikedTrack(track: Track): Promise<void> { return this.base.addLikedTrack(this.recordings.resolve(track)); }
  async removeLikedTrack(id: string): Promise<void> {
    for (const alias of this.recordings.aliases(id)) await this.base.removeLikedTrack(alias);
  }
  isAlbumSaved(id: string): Promise<boolean> { return this.base.isAlbumSaved(id); }
  getSavedAlbums(): Promise<Album[]> { return this.base.getSavedAlbums(); }
  addSavedAlbum(album: Album): Promise<void> { return this.base.addSavedAlbum(album); }
  removeSavedAlbum(id: string): Promise<void> { return this.base.removeSavedAlbum(id); }
  isArtistSaved(id: string): Promise<boolean> { return this.base.isArtistSaved(id); }
  getSavedArtists(): Promise<Artist[]> { return this.base.getSavedArtists(); }
  addSavedArtist(artist: Artist): Promise<void> { return this.base.addSavedArtist(artist); }
  removeSavedArtist(id: string): Promise<void> { return this.base.removeSavedArtist(id); }
  async getHistory(limit?: number): Promise<HistoryEntry[]> {
    return (await this.base.getHistory(limit)).map((entry) => ({ ...entry, track: this.recordings.resolve(entry.track, false) }));
  }
  addHistoryEntry(entry: HistoryEntry): Promise<void> {
    return this.base.addHistoryEntry({ ...entry, track: this.recordings.resolve(entry.track, false) });
  }
  clearHistory(): Promise<void> { return this.base.clearHistory(); }
  private playlist(playlist: Playlist): Playlist {
    return { ...playlist, trackIds: playlist.trackIds.map((id) => this.recordings.id(id)),
      tracks: playlist.tracks?.map((t) => this.recordings.resolve(t)) };
  }
  async getPlaylists(): Promise<Playlist[]> { return (await this.base.getPlaylists()).map((p) => this.playlist(p)); }
  async getPlaylist(id: string): Promise<Playlist | null> {
    const result = await this.base.getPlaylist(id);
    return result ? this.playlist(result) : null;
  }
  addPlaylist(playlist: Playlist): Promise<void> { return this.base.addPlaylist(this.playlist(playlist)); }
  updatePlaylist(playlist: Playlist): Promise<void> { return this.base.updatePlaylist(this.playlist(playlist)); }
  removePlaylist(id: string): Promise<void> { return this.base.removePlaylist(id); }
  saveQueueState(state: QueueState): Promise<void> { return this.base.saveQueueState(state); }
  async loadQueueState(): Promise<QueueState | null> {
    const result = await this.base.loadQueueState();
    return result ? { ...result, tracks: result.tracks.map((t) => this.recordings.resolve(t)) } : null;
  }
}
