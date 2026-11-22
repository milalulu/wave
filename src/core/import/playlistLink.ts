import type { Track } from "../types";
import type { AppServices } from "../../app/compose";
import type { YouTubeMusicProvider } from "../providers/YouTubeMusicProvider";
import type { SoundCloudProvider } from "../providers/SoundCloudProvider";

export interface PlaylistImportReport {
  name: string;
  tracks: Track[];
  unavailable: number;
  repeats: number;
}

export type PlaylistLink =
  | { kind: "youtube-video"; id: string }
  | { kind: "youtube-playlist"; id: string }
  | { kind: "soundcloud-likes"; profile: string }
  | { kind: "soundcloud"; url: string };

export function detectPlaylistLink(raw: string): PlaylistLink | null {
  const url = raw.trim();
  if (!/^https?:\/\//i.test(url)) return null;
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }
  const host = parsed.hostname;
  if (parsed.username || parsed.password || parsed.port) return null;
  const short = host === "youtu.be" || host === "www.youtu.be";
  if (short || ["youtube.com", "www.youtube.com", "music.youtube.com", "m.youtube.com"].includes(host)) {
    const list = parsed.searchParams.get("list");
    if (list && /^[A-Za-z0-9_-]{2,100}$/.test(list)) return { kind: "youtube-playlist", id: list };
    const [, section, pathId] = parsed.pathname.split("/");
    const id = short ? section : section === "watch" ? parsed.searchParams.get("v")
      : ["shorts", "embed", "live"].includes(section) ? pathId : undefined;
    if (id && /^[A-Za-z0-9_-]{6,}$/.test(id)) return { kind: "youtube-video", id };
  }
  if (host === "soundcloud.com" || host === "www.soundcloud.com") {
    const likes = parsed.pathname.match(/^\/([a-z0-9_-]+)\/likes\/?$/i);
    if (likes) return { kind: "soundcloud-likes", profile: likes[1] };
  }
  if (["soundcloud.com", "www.soundcloud.com", "on.soundcloud.com"].includes(host) && parsed.pathname !== "/") {
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
): Promise<{ name: string; tracks: Track[]; unavailable?: number }> {
  const link = detectPlaylistLink(raw);
  if (!link) throw new Error("Unsupported link. Use a YouTube Music, YouTube or SoundCloud link.");
  if (link.kind === "youtube-playlist" && typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent)) {
    throw new Error("YouTube Music playlist import is available on desktop.");
  }
  switch (link.kind) {
    case "youtube-video":
      return provider<YouTubeMusicProvider>(services, "youtube").importVideoFromUrl(link.id);
    case "youtube-playlist":
      return provider<YouTubeMusicProvider>(services, "youtube").importPlaylist(link.id);
    case "soundcloud":
      return provider<SoundCloudProvider>(services, "soundcloud").importFromUrl(link.url);
    case "soundcloud-likes":
      return provider<SoundCloudProvider>(services, "soundcloud").importPublicLikes(link.profile);
  }
}

export async function previewPlaylistImport(services: AppServices, url: string): Promise<PlaylistImportReport> {
  const imported = await importPlaylistLink(services, url);
  return makePlaylistImportReport(imported.name, imported.tracks, services.recordings, imported.unavailable);
}

export function makePlaylistImportReport(name: string, entries: Track[], recordings?: AppServices["recordings"], unavailable = 0): PlaylistImportReport {
  const tracks = entries.filter((track) => track && typeof track.id === "string" && track.id
    && typeof track.uri === "string" && track.uri && typeof track.title === "string"
    && typeof track.provider === "string" && !track.meta?.noPlay)
    .map((track) => recordings?.resolve(track) ?? track);
  return {
    name,
    tracks,
    unavailable: unavailable + entries.length - tracks.length,
    repeats: tracks.length - new Set(tracks.map((track) => track.id)).size,
  };
}
