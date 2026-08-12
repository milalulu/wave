import type { Album, Artist, HistoryEntry, Track } from "../types";
import type { Storage } from "../database/Storage";

export class LibraryService {
  constructor(private storage: Storage) {}

  async isLiked(track: Track): Promise<boolean> {
    return this.storage.isLiked(track.id);
  }

  async toggleLike(track: Track): Promise<boolean> {
    const liked = await this.storage.isLiked(track.id);
    if (liked) {
      await this.storage.removeLikedTrack(track.id);
    } else {
      await this.storage.addLikedTrack(track);
    }
    return !liked;
  }

  async getLikedTracks(): Promise<Track[]> {
    return this.storage.getLikedTracks();
  }

  async isAlbumSaved(album: Album): Promise<boolean> {
    return this.storage.getSavedAlbums().then((a) => a.some((x) => x.id === album.id));
  }

  async toggleSaveAlbum(album: Album): Promise<boolean> {
    const saved = await this.isAlbumSaved(album);
    if (saved) {
      await this.storage.removeSavedAlbum(album.id);
    } else {
      await this.storage.addSavedAlbum(album);
    }
    return !saved;
  }

  async getSavedAlbums(): Promise<Album[]> {
    return this.storage.getSavedAlbums();
  }

  async isArtistSaved(artist: Artist): Promise<boolean> {
    return this.storage.getSavedArtists().then((a) => a.some((x) => x.id === artist.id));
  }

  async toggleSaveArtist(artist: Artist): Promise<boolean> {
    const saved = await this.isArtistSaved(artist);
    if (saved) {
      await this.storage.removeSavedArtist(artist.id);
    } else {
      await this.storage.addSavedArtist(artist);
    }
    return !saved;
  }

  async getSavedArtists(): Promise<Artist[]> {
    return this.storage.getSavedArtists();
  }

  async getHistory(limit = 50): Promise<HistoryEntry[]> {
    return this.storage.getHistory(limit);
  }
}
