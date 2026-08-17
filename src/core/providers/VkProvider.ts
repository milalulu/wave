import type { SearchResults, Track } from "../types";
import type { AlbumDetail, ArtistDetail } from "../types";
import type { MusicProvider } from "./MusicProvider";

export interface VkGateway {
  search(query: string, count: number): Promise<unknown>;
}

interface VkAudio {
  id: string | number;
  owner: string | number;
  url: string;
  title: string;
  duration: number;
  artist: string;
}

export class VkProvider implements MusicProvider {
  readonly id = "vk";
  readonly name = "VK";

  constructor(private gateway: VkGateway) {}

  async search(query: string): Promise<SearchResults> {
    const raw = await this.gateway.search(query, 20);
    const audios = extractVkAudios(raw);
    const tracks: Track[] = audios.map((a) => ({
      id: `vk:track:${a.owner}_${a.id}`,
      provider: this.id,
      uri: a.url,
      title: a.title,
      artist: a.artist,
      duration: Number.isFinite(a.duration) ? a.duration : undefined,
    }));
    return { provider: this.id, tracks, albums: [], artists: [] };
  }

  async resolveUri(track: Track): Promise<string> {
    return track.uri;
  }

  async getAlbum(_albumId: string): Promise<AlbumDetail> {
    throw new Error("vk provider: no albums");
  }

  async getArtist(_artistId: string): Promise<ArtistDetail> {
    throw new Error("vk provider: no artists");
  }
}

function extractVkAudios(value: unknown): VkAudio[] {
  const out: VkAudio[] = [];
  const visit = (v: unknown): void => {
    if (Array.isArray(v)) {
      if (looksLikeAudio(v)) {
        const [, owner, url, title, duration, artist] = v as unknown[];
        out.push({
          id: String(v[0]),
          owner: String(owner),
          url: url as string,
          title: title as string,
          duration: toSeconds(duration),
          artist: String(artist ?? ""),
        });
        return;
      }
      for (const item of v) visit(item);
    } else if (typeof v === "object" && v !== null) {
      for (const val of Object.values(v as Record<string, unknown>)) visit(val);
    }
  };
  visit(value);
  return out;
}

function looksLikeAudio(v: unknown[]): boolean {
  if (v.length < 6) return false;
  const url = v[2];
  return (
    typeof url === "string" &&
    url.startsWith("http") &&
    typeof v[3] === "string" &&
    v[3].length > 0
  );
}

function toSeconds(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.round(n) : NaN;
}
