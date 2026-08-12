import type { Album, Artist, SearchResults, Track } from "../types";
import type { AlbumDetail, ArtistDetail } from "../types";
import type { MusicProvider } from "./MusicProvider";

const API = "https://itunes.apple.com";

interface ITunesResult {
  wrapperType: "track" | "collection" | "artist";
  trackId?: number;
  trackName?: string;
  artistId?: number;
  artistName?: string;
  collectionId?: number;
  collectionName?: string;
  collectionArtistName?: string;
  artworkUrl100?: string;
  previewUrl?: string;
  trackTimeMillis?: number;
  primaryGenreName?: string;
  releaseDate?: string;
  trackCount?: number;
}

function cover(url?: string, size = 300): string | undefined {
  if (!url) return undefined;
  return url.replace("100x100bb", `${size}x${size}bb`);
}

function trackId(r: ITunesResult): string | null {
  return r.trackId ? `itunes:track:${r.trackId}` : null;
}

function albumId(r: ITunesResult): string | null {
  return r.collectionId ? `itunes:album:${r.collectionId}` : null;
}

function artistId(r: ITunesResult): string | null {
  return r.artistId ? `itunes:artist:${r.artistId}` : null;
}

/**
 * Провайдер iTunes: поиск и 30-секундные превью — реальное аудио без ключей.
 */
export class iTunesProvider implements MusicProvider {
  readonly id = "itunes";
  readonly name = "iTunes";

  async search(query: string): Promise<SearchResults> {
    const url = `${API}/search?term=${encodeURIComponent(query)}&media=music&entity=musicTrack,album,musicArtist&limit=50`;
    const data = await this.fetchJson(url);
    const tracks: Track[] = [];
    const albums: Album[] = [];
    const artists: Artist[] = [];
    for (const r of data.results) {
      if (r.wrapperType === "track" && r.previewUrl) {
        const t = this.trackFromResult(r);
        if (t) tracks.push(t);
      } else if (r.wrapperType === "collection") {
        const a = this.albumFromResult(r);
        if (a) albums.push(a);
      } else if (r.wrapperType === "artist") {
        const ar = this.artistFromResult(r);
        if (ar) artists.push(ar);
      }
    }
    return { provider: this.id, tracks, albums, artists };
  }

  async resolveUri(track: Track): Promise<string> {
    return track.uri;
  }

  async getAlbum(albumIdValue: string): Promise<AlbumDetail> {
    const data = await this.fetchJson(`${API}/lookup?id=${numericId(albumIdValue)}&entity=song&limit=200`);
    let album: Album | undefined;
    const tracks: Track[] = [];
    for (const r of data.results) {
      if (r.wrapperType === "collection") {
        album = this.albumFromResult(r) ?? undefined;
      } else if (r.wrapperType === "track") {
        const t = this.trackFromResult(r);
        if (t) tracks.push(t);
      }
    }
    if (!album) throw new Error(`album not found: ${albumIdValue}`);
    return { album, tracks };
  }

  async getArtist(artistIdValue: string): Promise<ArtistDetail> {
    const data = await this.fetchJson(
      `${API}/lookup?id=${numericId(artistIdValue)}&entity=album,song&limit=200`,
    );
    let artist: Artist | undefined;
    const albums: Album[] = [];
    const topTracks: Track[] = [];
    for (const r of data.results) {
      if (r.wrapperType === "artist") {
        artist = this.artistFromResult(r) ?? undefined;
      } else if (r.wrapperType === "collection") {
        const a = this.albumFromResult(r);
        if (a) albums.push(a);
      } else if (r.wrapperType === "track") {
        const t = this.trackFromResult(r);
        if (t) topTracks.push(t);
      }
    }
    if (!artist) throw new Error(`artist not found: ${artistIdValue}`);
    return { artist, topTracks, albums };
  }

  private trackFromResult(r: ITunesResult): Track | null {
    const id = trackId(r);
    if (!id || !r.trackName || !r.previewUrl) return null;
    return {
      id,
      provider: this.id,
      uri: r.previewUrl,
      title: r.trackName,
      artist: r.artistName,
      album: r.collectionName,
      albumArtist: r.collectionArtistName,
      coverUrl: cover(r.artworkUrl100),
      duration: r.trackTimeMillis ? Math.round(r.trackTimeMillis / 1000) : undefined,
      genre: r.primaryGenreName,
      year: r.releaseDate ? new Date(r.releaseDate).getFullYear() : undefined,
    };
  }

  private albumFromResult(r: ITunesResult): Album | null {
    const id = albumId(r);
    if (!id || !r.collectionName) return null;
    return {
      id,
      provider: this.id,
      title: r.collectionName,
      artist: r.collectionArtistName ?? r.artistName,
      coverUrl: cover(r.artworkUrl100),
      year: r.releaseDate ? new Date(r.releaseDate).getFullYear() : undefined,
      trackCount: r.trackCount,
    };
  }

  private artistFromResult(r: ITunesResult): Artist | null {
    const id = artistId(r);
    if (!id || !r.artistName) return null;
    return {
      id,
      provider: this.id,
      name: r.artistName,
    };
  }

  private async fetchJson(url: string): Promise<{ results: ITunesResult[] }> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`iTunes API failed: ${res.status}`);
    return (await res.json()) as { results: ITunesResult[] };
  }
}

function numericId(composite: string): string {
  return composite.split(":").pop() ?? composite;
}
