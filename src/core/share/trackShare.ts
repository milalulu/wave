import type { Track } from "../types";

/** Публичная ссылка на трек, если она есть и открывается вне приложения. */
export function shareableUrl(track: Track): string | null {
  const meta = track.meta ?? {};
  const spotify = meta.spotifyUrl;
  if (typeof spotify === "string" && spotify.startsWith("http")) return spotify;
  const uri = track.uri ?? "";
  if (
    /^https?:\/\/(www\.|m\.|music\.)?youtube\.com\/(watch|embed|shorts|live)\b/i.test(uri) ||
    /^https?:\/\/youtu\.be\//i.test(uri)
  ) {
    return uri;
  }
  return null;
}

export function shareText(track: Track): string {
  const base = [track.artist, track.title].filter(Boolean).join(" — ") || "Unknown track";
  const url = shareableUrl(track);
  return url ? `${base}\n${url}` : base;
}
