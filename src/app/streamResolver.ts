import { playbackSource } from "../core/types";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { Track } from "../core/types";
import type { MusicProvider } from "../core/providers/MusicProvider";
import { streamCache } from "../core/player/streamCache";
import { PROXY_BASE } from "../core/player/WebAudioAdapter";
import { isBlockedProvider, isStreamingProvider } from "./platformSettings";
import { downloadedFiles, findDownloadedFile, findMissingDownloads, offlineEnabled } from "./offline";
import { resolveYtQuality } from "./ytQuality";
import { isLocalMediaUri } from "../core/util/localMedia";
import { cachedAudioUri, loadOfflineCacheMode } from "./offlineCache";

export function createStreamResolver(
  providers: MusicProvider[],
  findReplacement?: (track: Track) => Promise<Track[]>,
): (track: Track) => Promise<string> {
  const pending = new Map<string, Promise<string>>();
  const resolve = async (track: Track): Promise<string> => {
    const recording = track;
    track = playbackSource(track);
    if (isLocalMediaUri(track.uri)) return track.uri;
    const local = findDownloadedFile(track, downloadedFiles());
    if (local && !(await findMissingDownloads([local.file])).has(local.file)) return convertFileSrc(local.file);
    if (loadOfflineCacheMode() !== "off") {
      const stored = await cachedAudioUri(track);
      if (stored) return stored;
    }
    if (isStreamingProvider(track.provider) && isBlockedProvider(track.provider))
      throw new Error(`provider blocked: ${track.provider}`);
    if (offlineEnabled()) throw new Error(local ? "offline mode: downloaded file is missing" : "offline mode: track not downloaded");
    if (!isStreamingProvider(track.provider)) {
      for (const candidate of await findReplacement?.(recording) ?? []) {
        if (!isStreamingProvider(playbackSource(candidate).provider)) continue;
        try {
          return await resolve(candidate);
        } catch {
          // Try the next matching recording on an available platform.
        }
      }
      throw new Error("This source was removed and no playable match was found on YouTube Music or SoundCloud");
    }
    const quality = track.provider === "youtube" ? resolveYtQuality() : "";
    const cached = streamCache.get(track.id, quality);
    if (cached) return cached;
    const key = JSON.stringify([track.id, quality]);
    const existing = pending.get(key);
    if (existing) return existing;
    const request = (async () => {
      const provider = providers.find((p) => p.id === track.provider);
      const raw = provider ? await provider.resolveUri(track) : track.uri;
      const parsed = URL.canParse(raw) ? new URL(raw) : null;
      const proxyAudio = parsed?.protocol === "https:" &&
        ["googlevideo.com", "sndcdn.com", "media-streaming.soundcloud.cloud"].some(
          (host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`),
        ) && !/\.(m3u8|mpd)$/i.test(parsed.pathname);
      const url = proxyAudio
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
  return resolve;
}
