import type { SearchResults, Track } from "../types";
import type { AlbumDetail, ArtistDetail } from "../types";
import type { MusicProvider } from "./MusicProvider";
import type { HttpJsonGateway } from "./HttpGateway";

const API = "https://musicbrainz.org/ws/2";
const USER_AGENT = "Wave/0.1.9 (https://github.com/milalulu/wave; music client)";

interface MbArtistCredit {
  name?: string;
}

interface MbRelease {
  title?: string;
  first_release_date?: string;
}

interface MbRecording {
  id: string;
  title?: string;
  artist_credit?: MbArtistCredit[];
  length?: number;
  releases?: MbRelease[];
  tags?: { name: string; count?: number }[];
}

export interface MbRecordingMeta {
  mbid: string;
  tags: string[];
}

export class MusicBrainzProvider implements MusicProvider {
  readonly id = "musicbrainz";
  readonly name = "MusicBrainz";

  constructor(private http: HttpJsonGateway) {}

  private metaCache = new Map<string, { data: MbRecordingMeta; at: number }>();
  private static readonly META_CACHE_TTL_MS = 60 * 60 * 1000;

  async getRecordingMeta(title: string, artist: string): Promise<MbRecordingMeta | null> {
    const key = `${artist}|${title}`.toLowerCase();
    const hit = this.metaCache.get(key);
    if (hit && Date.now() - hit.at < MusicBrainzProvider.META_CACHE_TTL_MS) return hit.data;

    try {
      const query = encodeURIComponent(`recording:"${title}" AND artist:"${artist}"`);
      const url = `${API}/recording?query=${query}&fmt=json&limit=1`;
      const { status, body } = await this.http.json("GET", url, undefined, {
        "User-Agent": USER_AGENT,
        "Content-Type": "application/json",
      });
      if (status !== 200) return null;
      const recordings = (body as { recordings?: MbRecording[] }).recordings ?? [];
      const rec = recordings[0];
      if (!rec?.id) return null;

      const tagUrl = `${API}/recording/${rec.id}?inc=tags&fmt=json`;
      const tagRes = await this.http.json("GET", tagUrl, undefined, {
        "User-Agent": USER_AGENT,
        "Content-Type": "application/json",
      });
      if (tagRes.status !== 200) return null;
      const tagBody = tagRes.body as { tags?: { name: string; count?: number }[] };
      const tags = (tagBody.tags ?? [])
        .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
        .slice(0, 20)
        .map((t) => t.name.toLowerCase());

      const result: MbRecordingMeta = { mbid: rec.id, tags };
      this.metaCache.set(key, { data: result, at: Date.now() });
      return result;
    } catch {
      return null;
    }
  }

  async search(query: string): Promise<SearchResults> {
    const url = `${API}/recording?query=${encodeURIComponent(query)}&fmt=json&limit=20`;
    const { status, body } = await this.http.json("GET", url, undefined, {
      "User-Agent": USER_AGENT,
      "Content-Type": "application/json",
    });
    if (status !== 200) throw new Error(`musicbrainz search failed: ${status}`);
    const recordings = (body as { recordings?: MbRecording[] }).recordings ?? [];
    const tracks: Track[] = recordings
      .filter((r) => r.id && r.title)
      .map((r) => {
        const release = r.releases?.[0];
        return {
          id: `musicbrainz:track:${r.id}`,
          provider: this.id,
          uri: "",
          title: r.title ?? "",
          artist: r.artist_credit?.[0]?.name,
          album: release?.title,
          year: release?.first_release_date
            ? new Date(release.first_release_date).getFullYear()
            : undefined,
          duration: r.length ? Math.round(r.length / 1000) : undefined,
          meta: { noPlay: true },
        };
      });
    return { provider: this.id, tracks, albums: [], artists: [] };
  }

  async resolveUri(_track: Track): Promise<string> {
    throw new Error("musicbrainz: no audio");
  }

  async getAlbum(_albumId: string): Promise<AlbumDetail> {
    throw new Error("musicbrainz: no album detail");
  }

  async getArtist(_artistId: string): Promise<ArtistDetail> {
    throw new Error("musicbrainz: no artist detail");
  }
}
