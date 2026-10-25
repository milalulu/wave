import { playbackSource } from "../core/types";
import type { Track } from "../core/types";
import type { MusicProvider } from "../core/providers/MusicProvider";
import { streamCache } from "../core/player/streamCache";
import { PROXY_BASE } from "../core/player/WebAudioAdapter";
import { isBlockedProvider } from "./platformSettings";
import { localUriFor, offlineEnabled } from "./offline";
import { resolveYtQuality } from "./ytQuality";
import { isLocalMediaUri } from "../core/util/localMedia";

export function createStreamResolver(
  providers: MusicProvider[],
): (track: Track) => Promise<string> {
  const pending = new Map<string, Promise<string>>();
  return async (track) => {
    track = playbackSource(track);
    if (isBlockedProvider(track.provider))
      throw new Error(`provider blocked: ${track.provider}`);
    if (isLocalMediaUri(track.uri)) return track.uri;
    const local = localUriFor(track);
    if (local) return local;
    if (offlineEnabled()) throw new Error("offline mode: track not downloaded");
    const quality = track.provider === "youtube" ? resolveYtQuality() : "";
    const cached = streamCache.get(track.id, quality);
    if (cached) return cached;
    const key = JSON.stringify([track.id, quality]);
    const existing = pending.get(key);
    if (existing) return existing;
    const request = (async () => {
      const provider = providers.find((p) => p.id === track.provider);
      const raw = provider ? await provider.resolveUri(track) : track.uri;
      const url = raw.includes("googlevideo.com")
        ? `${PROXY_BASE}/audio?url=${encodeURIComponent(raw)}`
        : raw;
      if (offlineEnabled())
        throw new Error("offline mode: track not downloaded");
      if (isBlockedProvider(track.provider))
        throw new Error(`provider blocked: ${track.provider}`);
      if (providers.find((p) => p.id === track.provider) !== provider) {
        throw new Error("provider configuration changed");
      }
      streamCache.set(track.id, url, quality);
      return url;
    })();
    pending.set(key, request);
    try {
      return await request;
    } finally {
      pending.delete(key);
    }
  };
}
