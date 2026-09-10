import type { Track } from "../types";
import type { AppServices } from "../../app/compose";
import type { SpotifyProvider } from "../providers/SpotifyProvider";
import type { YouTubeMusicProvider } from "../providers/YouTubeMusicProvider";
import type { SoundCloudProvider } from "../providers/SoundCloudProvider";

export type PlaylistLink =
  | { kind: "spotify"; sub: "track" | "album" | "playlist"; id: string }
  | { kind: "youtube-video"; id: string }
  | { kind: "youtube-playlist"; id: string }
  | { kind: "soundcloud"; url: string };

export function detectPlaylistLink(raw: string): PlaylistLink | null {
  const url = raw.trim();
  if (!/^https?:\/\//i.test(url)) return null;
  let m = url.match(/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(track|album|playlist)\/([A-Za-z0-9]+)/i);
  if (m) return { kind: "spotify", sub: m[1].toLowerCase() as "track" | "album" | "playlist", id: m[2] };
  m = url.match(/[?&]list=([A-Za-z0-9_-]+)/);
  if (m && /youtu\.?be/.test(url)) return { kind: "youtube-playlist", id: m[1] };
  m = url.match(/(?:youtube\.com\/(?:watch\?[^#]*v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/i);
  if (m) return { kind: "youtube-video", id: m[1] };
  if (/^(https?:\/\/)?(www\.)?soundcloud\.com\/.+/i.test(url) || /^https?:\/\/on\.soundcloud\.com\//i.test(url)) {
    return { kind: "soundcloud", url };
  }
  return null;
}

function provider<T>(services: AppServices, id: string): T {
  const p = services.providers.find((x) => x.id === id);
  if (!p) throw new Error(`provider unavailable: ${id}`);
  return p as unknown as T;
}

export async function importPlaylistLink(
  services: AppServices,
  raw: string,
): Promise<{ name: string; tracks: Track[] }> {
  const link = detectPlaylistLink(raw);
  if (!link) throw new Error("unsupported link (spotify / youtube video / soundcloud)");
  switch (link.kind) {
    case "spotify":
      return provider<SpotifyProvider>(services, "spotify").importFromUrl(link.sub, link.id);
    case "youtube-video":
      return provider<YouTubeMusicProvider>(services, "youtube").importVideoFromUrl(link.id);
    case "youtube-playlist":
      throw new Error("youtube playlists import not supported yet (single videos only)");
    case "soundcloud":
      return provider<SoundCloudProvider>(services, "soundcloud").importFromUrl(link.url);
  }
}
