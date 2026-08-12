import type { SearchResults, Track } from "../types";
import type { AlbumDetail, ArtistDetail } from "../types";
import type { MusicProvider } from "./MusicProvider";
import type { HttpJsonGateway } from "./HttpGateway";

const API = "https://api.genius.com";

interface GeniusHitResult {
  id?: number;
  title?: string;
  full_title?: string;
  url?: string;
  header_image_thumbnail_url?: string;
  primary_artist?: { name?: string };
}

interface GeniusSearchResponse {
  response?: { hits?: { result?: GeniusHitResult }[] };
}

/**
 * Провайдер Genius (метаданные/тексты песен, API token из конфига).
 * Аудио не стримится — треки помечаются meta.noPlay.
 */
export class GeniusProvider implements MusicProvider {
  readonly id = "genius";
  readonly name = "Genius";

  constructor(
    private http: HttpJsonGateway,
    private token: string,
  ) {}

  async search(query: string): Promise<SearchResults> {
    const url = `${API}/search?q=${encodeURIComponent(query)}`;
    const { status, body } = await this.http.json("GET", url, undefined, {
      Authorization: `Bearer ${this.token}`,
    });
    if (status !== 200) throw new Error(`genius search failed: ${status}`);
    const hits = (body as GeniusSearchResponse)?.response?.hits ?? [];
    const tracks: Track[] = [];
    for (const h of hits) {
      const r = h.result;
      if (!r?.title || !r.id) continue;
      tracks.push({
        id: `genius:song:${r.id}`,
        provider: this.id,
        uri: "",
        title: r.title,
        artist: r.primary_artist?.name ?? "",
        coverUrl: r.header_image_thumbnail_url,
        meta: { noPlay: true, url: r.url },
      });
    }
    return { provider: this.id, tracks, albums: [], artists: [] };
  }

  async resolveUri(_track: Track): Promise<string> {
    throw new Error("genius: no audio");
  }

  async getAlbum(_albumId: string): Promise<AlbumDetail> {
    throw new Error("genius: no album detail");
  }

  async getArtist(_artistId: string): Promise<ArtistDetail> {
    throw new Error("genius: no artist detail");
  }
}

export type { GeniusSearchResponse };
export type { GeniusHitResult };
