import type { Track } from "../types";

/** Recover only artwork tied to this recording; never substitute another album. */
export function trackCover(track: Track | null | undefined): string | undefined {
  if (!track) return undefined;
  if (track.coverUrl) return track.coverUrl;
  if (track.playbackSource?.coverUrl) return track.playbackSource.coverUrl;
  if (track.provider === "youtube") {
    const id = track.meta?.ytId ?? track.id.replace(/^youtube:track:/, "");
    if (typeof id === "string" && /^[A-Za-z0-9_-]{11}$/.test(id)) {
      return `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
    }
  }
  return undefined;
}
