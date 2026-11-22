import { playbackSource, type Track } from "../types";

/** Публичная ссылка на трек, если она есть и открывается вне приложения. */
export function shareableUrl(track: Track): string | null {
  const source = playbackSource(track);
  const uri = source.uri ?? "";
  if (source.provider === "soundcloud") {
    const link = source.meta?.scUrl ?? uri;
    return typeof link === "string" && /^https?:\/\/(?:[\w-]+\.)?soundcloud\.com\//i.test(link)
      ? link : null;
  }
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
