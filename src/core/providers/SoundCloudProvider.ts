import type { SearchResults, Track } from "../types";
import type { AlbumDetail, ArtistDetail } from "../types";
import type { MusicProvider } from "./MusicProvider";
import type { HttpJsonGateway } from "./HttpGateway";

interface ScUser {
  username?: string;
}

interface ScTrack {
  id: number;
  title?: string;
  user?: ScUser;
  artwork_url?: string;
  duration?: number;
  media?: { transcodings?: ScTranscoding[] };
  access?: { token?: string };
}

interface ScTranscoding {
  url?: string;
  format?: { protocol?: string; mime_type?: string };
}

const API = "https://api-v2.soundcloud.com";

/** Стрим-URL (signature + track_authorization) годен не вечно — кэшируем с TTL. */
const STREAM_TTL_MS = 20 * 60 * 1000;

function cover(url?: string): string | undefined {
  if (!url) return undefined;
  return url.replace(/-large\.jpg$/, "-t500x500.jpg");
}

/**
 * Провайдер SoundCloud через неофициальный api-v2 (client_id из конфига).
 * Стрим — progressive mp3; разрешается лениво в resolveUri.
 */
export class SoundCloudProvider implements MusicProvider {
  readonly id = "soundcloud";
  readonly name = "SoundCloud";

  constructor(
    private http: HttpJsonGateway,
    private clientId: string,
  ) {}

  private streamCache = new Map<string, { url: string; at: number }>();

  async search(query: string): Promise<SearchResults> {
    const url = `${API}/search/tracks?q=${encodeURIComponent(query)}&client_id=${encodeURIComponent(this.clientId)}&limit=20`;
    const { status, body } = await this.http.json("GET", url);
    if (status !== 200) throw new Error(`soundcloud search failed: ${status}`);
    const collection = ((body as { collection?: ScTrack[] }).collection ?? []).filter(
      (t) => t?.id != null && t.title,
    );
    const tracks: Track[] = collection.map((r) => ({
      id: `soundcloud:track:${r.id}`,
      provider: this.id,
      uri: `soundcloud://track/${r.id}`,
      title: r.title ?? "Unknown",
      artist: r.user?.username,
      coverUrl: cover(r.artwork_url),
      duration: r.duration ? Math.round(r.duration / 1000) : undefined,
      meta: { scId: r.id, scToken: r.access?.token },
    }));
    return { provider: this.id, tracks, albums: [], artists: [] };
  }

  async resolveUri(track: Track): Promise<string> {
    const scId = (track.meta?.scId as number | undefined) ?? Number(track.id.split(":").pop());
    if (!scId) throw new Error("soundcloud: no track id");
    const key = `${scId}`;
    const hit = this.streamCache.get(key);
    if (hit && Date.now() - hit.at < STREAM_TTL_MS) return hit.url;
    const { status, body } = await this.http.json(
      "GET",
      `${API}/tracks/${scId}?client_id=${encodeURIComponent(this.clientId)}`,
    );
    if (status !== 200) throw new Error(`soundcloud track ${scId}: ${status}`);
    const info = body as ScTrack;
    const transcoding = info.media?.transcodings?.find(
      (t) => t.format?.protocol === "progressive" && t.format.mime_type?.startsWith("audio/mpeg"),
    );
    if (!transcoding?.url) throw new Error(`soundcloud ${scId}: no progressive mp3`);
    const auth = info.access?.token ? `&track_authorization=${encodeURIComponent(info.access.token)}` : "";
    const streamRes = await this.http.json(
      "GET",
      `${transcoding.url}?client_id=${encodeURIComponent(this.clientId)}${auth}`,
    );
    const streamUrl = (streamRes.body as { url?: string })?.url;
    if (!streamUrl) throw new Error(`soundcloud ${scId}: no stream url`);
    this.streamCache.set(key, { url: streamUrl, at: Date.now() });
    if (this.streamCache.size > 128) {
      const first = this.streamCache.keys().next().value;
      if (first !== undefined) this.streamCache.delete(first);
    }
    return streamUrl;
  }

  async getAlbum(_albumId: string): Promise<AlbumDetail> {
    throw new Error("soundcloud provider: no albums");
  }

  async getArtist(_artistId: string): Promise<ArtistDetail> {
    throw new Error("soundcloud provider: no artists");
  }
}
