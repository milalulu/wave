import Database from "@tauri-apps/plugin-sql";
import type { Album, Artist, HistoryEntry, Playlist, Track } from "../core/types";
import type { QueueState, Storage } from "../core/database/Storage";

const DB_NAME = "sqlite:wave.db";

export class SqliteStorage implements Storage {
  private dbPromise: Promise<Database>;

  constructor() {
    this.dbPromise = Database.load(DB_NAME);
  }

  async init(): Promise<void> {
    await this.dbPromise;
  }

  private async requireDb(): Promise<Database> {
    return this.dbPromise;
  }

  async isLiked(trackId: string): Promise<boolean> {
    const rows = await (await this.requireDb()).select<{ ok: number }[]>(
      "SELECT 1 AS ok FROM liked_tracks WHERE id = $1 LIMIT 1",
      [trackId],
    );
    return rows.length > 0;
  }

  async getLikedTracks(): Promise<Track[]> {
    const rows = await (await this.requireDb()).select<{ track_json: string }[]>(
      "SELECT id, track_json FROM liked_tracks ORDER BY liked_at DESC",
    );
    return rows.map((r) => JSON.parse(r.track_json) as Track);
  }

  async addLikedTrack(track: Track): Promise<void> {
    await (await this.requireDb()).execute(
      "INSERT OR REPLACE INTO liked_tracks (id, track_json, liked_at) VALUES ($1, $2, $3)",
      [track.id, JSON.stringify(track), Date.now()],
    );
  }

  async removeLikedTrack(trackId: string): Promise<void> {
    await (await this.requireDb()).execute("DELETE FROM liked_tracks WHERE id = $1", [trackId]);
  }

  async getSavedAlbums(): Promise<Album[]> {
    const rows = await (await this.requireDb()).select<{ album_json: string }[]>(
      "SELECT id, album_json FROM saved_albums ORDER BY saved_at DESC",
    );
    return rows.map((r) => JSON.parse(r.album_json) as Album);
  }

  async isAlbumSaved(albumId: string): Promise<boolean> {
    const rows = await (await this.requireDb()).select<{ ok: number }[]>(
      "SELECT 1 AS ok FROM saved_albums WHERE id = $1 LIMIT 1",
      [albumId],
    );
    return rows.length > 0;
  }

  async addSavedAlbum(album: Album): Promise<void> {
    await (await this.requireDb()).execute(
      "INSERT OR REPLACE INTO saved_albums (id, album_json, saved_at) VALUES ($1, $2, $3)",
      [album.id, JSON.stringify(album), Date.now()],
    );
  }

  async removeSavedAlbum(albumId: string): Promise<void> {
    await (await this.requireDb()).execute("DELETE FROM saved_albums WHERE id = $1", [albumId]);
  }

  async getSavedArtists(): Promise<Artist[]> {
    const rows = await (await this.requireDb()).select<{ artist_json: string }[]>(
      "SELECT id, artist_json FROM saved_artists ORDER BY saved_at DESC",
    );
    return rows.map((r) => JSON.parse(r.artist_json) as Artist);
  }

  async isArtistSaved(artistId: string): Promise<boolean> {
    const rows = await (await this.requireDb()).select<{ ok: number }[]>(
      "SELECT 1 AS ok FROM saved_artists WHERE id = $1 LIMIT 1",
      [artistId],
    );
    return rows.length > 0;
  }

  async addSavedArtist(artist: Artist): Promise<void> {
    await (await this.requireDb()).execute(
      "INSERT OR REPLACE INTO saved_artists (id, artist_json, saved_at) VALUES ($1, $2, $3)",
      [artist.id, JSON.stringify(artist), Date.now()],
    );
  }

  async removeSavedArtist(artistId: string): Promise<void> {
    await (await this.requireDb()).execute("DELETE FROM saved_artists WHERE id = $1", [artistId]);
  }

  async getHistory(limit?: number): Promise<HistoryEntry[]> {
    const rows = await (await this.requireDb()).select<{ track_json: string; played_at: number }[]>(
      "SELECT track_json, played_at FROM history ORDER BY played_at DESC LIMIT $1",
      [limit ?? 1000],
    );
    return rows.map((r) => ({ track: JSON.parse(r.track_json) as Track, playedAt: r.played_at }));
  }

  async addHistoryEntry(entry: HistoryEntry): Promise<void> {
    await (await this.requireDb()).execute(
      "INSERT INTO history (track_json, played_at) VALUES ($1, $2)",
      [JSON.stringify(entry.track), entry.playedAt],
    );
  }

  async clearHistory(): Promise<void> {
    await (await this.requireDb()).execute("DELETE FROM history");
  }

  async getPlaylists(): Promise<Playlist[]> {
    const rows = await (await this.requireDb()).select<{ playlist_json: string }[]>(
      "SELECT id, playlist_json FROM playlists ORDER BY updated_at DESC",
    );
    return rows.map((r) => JSON.parse(r.playlist_json) as Playlist);
  }

  async getPlaylist(id: string): Promise<Playlist | null> {
    const rows = await (await this.requireDb()).select<{ playlist_json: string }[]>(
      "SELECT playlist_json FROM playlists WHERE id = $1",
      [id],
    );
    return rows[0] ? (JSON.parse(rows[0].playlist_json) as Playlist) : null;
  }

  async addPlaylist(playlist: Playlist): Promise<void> {
    await (await this.requireDb()).execute(
      "INSERT OR REPLACE INTO playlists (id, playlist_json, created_at, updated_at) VALUES ($1, $2, $3, $4)",
      [playlist.id, JSON.stringify(playlist), playlist.createdAt, playlist.updatedAt],
    );
  }

  async updatePlaylist(playlist: Playlist): Promise<void> {
    await (await this.requireDb()).execute(
      "UPDATE playlists SET playlist_json = $1, updated_at = $2 WHERE id = $3",
      [JSON.stringify(playlist), Date.now(), playlist.id],
    );
  }

  async removePlaylist(id: string): Promise<void> {
    await (await this.requireDb()).execute("DELETE FROM playlists WHERE id = $1", [id]);
  }

  async saveQueueState(state: QueueState): Promise<void> {
    const db = await this.requireDb();
    await db.execute("DELETE FROM queue_state");
    await db.execute(
      "INSERT INTO queue_state (id, tracks_json, track_index, position) VALUES ('current', $1, $2, $3)",
      [JSON.stringify(state.tracks), state.index, state.position],
    );
  }

  async loadQueueState(): Promise<QueueState | null> {
    const rows = await (await this.requireDb()).select<
      { tracks_json: string; track_index: number; position: number }[]
    >("SELECT tracks_json, track_index, position FROM queue_state WHERE id = 'current' LIMIT 1");
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      tracks: JSON.parse(r.tracks_json) as Track[],
      index: r.track_index,
      position: r.position,
    };
  }
}
