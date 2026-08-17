import type { SearchResults, Track } from "../types";
import type { AlbumDetail, ArtistDetail } from "../types";
import type { MusicProvider } from "./MusicProvider";
import type { HttpJsonGateway } from "./HttpGateway";

const API = "https://musicbrainz.org/ws/2";
const USER_AGENT = "Wave/0.1 (https://example.invalid; music client)";

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
}

export class MusicBrainzProvider implements MusicProvider {
  readonly id = "musicbrainz";
  readonly name = "MusicBrainz";

  constructor(private http: HttpJsonGateway) {}

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
