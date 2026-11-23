import type Hls from "hls.js";

export const HLS_PLAYBACK_UNAVAILABLE = "HLS playback is unavailable";

export type HlsPlaybackMode = "media-source" | "native" | "unavailable";

interface HlsCapabilities extends Pick<typeof Hls, "isSupported" | "isMSESupported"> {
  getMediaSource(): Pick<typeof MediaSource, "isTypeSupported"> | undefined;
}

export function getHlsPlaybackMode(
  hls: HlsCapabilities,
  element: Pick<HTMLAudioElement, "canPlayType">,
): HlsPlaybackMode {
  if (hls.isSupported()) return "media-source";
  if (hls.isMSESupported()) {
    // hls.js also handles MP3 and Opus audio streams, which its default probe omits.
    const source = hls.getMediaSource();
    const audioTypes = ["audio/mpeg", 'audio/mp4; codecs="mp3"', 'audio/mp4; codecs="opus"'];
    if (audioTypes.some((type) => source?.isTypeSupported?.(type))) return "media-source";
  }
  return element.canPlayType("application/vnd.apple.mpegurl") ? "native" : "unavailable";
}
