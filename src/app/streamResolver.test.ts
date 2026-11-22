import { beforeEach, it, expect, vi } from "vitest";
import { createStreamResolver } from "./streamResolver";
import { streamCache } from "../core/player/streamCache";
import type { MusicProvider } from "../core/providers/MusicProvider";
import type { Track } from "../core/types";
const flags = vi.hoisted(() => ({
  offline: false,
  blocked: false,
  quality: "best",
  local: null as string | null,
  missing: false,
}));
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (path: string) => path }));
vi.mock("./offline", () => ({
  offlineEnabled: () => flags.offline,
  downloadedFiles: () => [],
  findDownloadedFile: () => flags.local ? { file: flags.local } : undefined,
  findMissingDownloads: ([file]: string[]) => new Set(flags.missing ? [file] : []),
}));
vi.mock(import("./platformSettings"), async (importOriginal) => ({
  ...await importOriginal(),
  isBlockedProvider: () => flags.blocked,
}));
vi.mock("./ytQuality", () => ({ resolveYtQuality: () => flags.quality }));
const track: Track = {
  id: "youtube:x",
  provider: "youtube",
  title: "Song",
  uri: "x",
};
beforeEach(() => {
  streamCache.clear();
  flags.offline = false;
  flags.blocked = false;
  flags.quality = "best";
  flags.local = null;
  flags.missing = false;
});
it("streams a missing downloaded copy online and reports it explicitly offline", async () => {
  flags.local = "asset://localhost/music/missing.m4a";
  flags.missing = true;
  const resolveUri = vi.fn(async () => "https://example.org/song.mp3");
  const resolve = createStreamResolver([{ id: "youtube", resolveUri } as unknown as MusicProvider]);
  expect(await resolve(track)).toBe("https://example.org/song.mp3");
  flags.offline = true;
  await expect(resolve(track)).rejects.toThrow("downloaded file is missing");
  expect(resolveUri).toHaveBeenCalledTimes(1);
});
it("uses the downloaded copy when its online provider is disabled", async () => {
  flags.local = "asset://localhost/music/song.m4a";
  flags.blocked = true;
  flags.offline = true;
  const resolveUri = vi.fn();
  const resolve = createStreamResolver([{ id: "youtube", resolveUri } as unknown as MusicProvider]);
  await expect(resolve(track)).resolves.toBe(flags.local);
  expect(resolveUri).not.toHaveBeenCalled();
});
it("rejects legacy streaming sources even with a direct audio URL", async () => {
  const resolve = createStreamResolver([]);
  await expect(resolve({ ...track, provider: "itunes", uri: "https://example.org/preview.m4a" }))
    .rejects.toThrow("no playable match");
});
it("uses a matching active source for saved streaming tracks whose platform was removed", async () => {
  const legacy = { ...track, provider: "deezer" };
  const resolveUri = vi.fn(async () => "https://example.org/song.mp3");
  const findReplacement = vi.fn(async () => [track]);
  const resolve = createStreamResolver([{ id: "youtube", resolveUri } as unknown as MusicProvider], findReplacement);
  await expect(resolve(legacy)).resolves.toBe("https://example.org/song.mp3");
  expect(findReplacement).toHaveBeenCalledWith(legacy);
  expect(resolveUri).toHaveBeenCalledWith(track);
});
it.each(["asset://localhost/music/song.mp3", "http://asset.localhost/music/song.mp3", "file:///music/song.mp3"])("plays local files in offline mode: %s", async (uri) => {
  flags.offline = true;
  const resolveUri = vi.fn();
  const resolve = createStreamResolver([{ id: "local", resolveUri } as unknown as MusicProvider]);
  await expect(resolve({ ...track, provider: "local", uri })).resolves.toBe(uri);
  expect(resolveUri).not.toHaveBeenCalled();
});

it("does not mistake a remote hostname containing asset.localhost for a local file", async () => {
  flags.offline = true;
  await expect(createStreamResolver([])({ ...track, uri: "https://asset.localhost.example.org/song.mp3" })).rejects.toThrow("offline");
});
it.each([
  ["https://cf-media.sndcdn.com/track.mp3", true],
  ["https://playback.media-streaming.soundcloud.cloud/track.m3u8", false],
  ["https://sndcdn.com.example.test/track.mp3", false],
])("uses the Web Audio proxy only for supported progressive media (%s)", async (raw, proxied) => {
  const resolveUri = vi.fn().mockResolvedValue(raw);
  const resolve = createStreamResolver([{ id: "soundcloud", resolveUri } as unknown as MusicProvider]);
  await expect(resolve({ ...track, provider: "soundcloud" })).resolves.toBe(proxied
    ? `http://127.0.0.1:8299/audio?url=${encodeURIComponent(raw)}` : raw);
});
it("coalesces simultaneous background and playback resolves, then respects quality changes", async () => {
  const resolveUri = vi.fn(async () => "https://example.org/music.mp3"),
    resolve = createStreamResolver([
      { id: "youtube", resolveUri } as unknown as MusicProvider,
    ]);
  await Promise.all([resolve(track), resolve(track)]);
  expect(resolveUri).toHaveBeenCalledTimes(1);
  await resolve(track);
  expect(resolveUri).toHaveBeenCalledTimes(1);
  flags.quality = "low";
  await resolve(track);
  expect(resolveUri).toHaveBeenCalledTimes(2);
});
it("does not let cached URLs bypass offline mode or provider blocking", async () => {
  streamCache.set(track.id, "https://example.org/song.mp3", "best");
  const resolve = createStreamResolver([]);
  flags.offline = true;
  await expect(resolve(track)).rejects.toThrow("offline");
  flags.offline = false;
  flags.blocked = true;
  await expect(resolve(track)).rejects.toThrow("blocked");
});
it("rejects results from a provider replaced during resolution", async () => {
  let finish!: (url: string) => void;
  const providers = [
    {
      id: "youtube",
      resolveUri: () =>
        new Promise<string>((r) => {
          finish = r;
        }),
    } as unknown as MusicProvider,
  ];
  const resolve = createStreamResolver(providers);
  const pending = resolve(track);
  providers.splice(0);
  finish("https://example.org/song.mp3");
  await expect(pending).rejects.toThrow("configuration changed");
  expect(streamCache.get(track.id, "best")).toBeNull();
});

it("resolves and caches the actual source without passing a library ID to its provider", async () => {
  const source = { ...track, id: "youtube:alternate", uri: "alternate" };
  const resolveUri = vi.fn(async () => "https://example.org/alternate.mp3");
  const resolve = createStreamResolver([{ id: "youtube", resolveUri } as unknown as MusicProvider]);
  const recording = { ...track, id: "itunes:original", provider: "itunes", playbackSource: source };
  await resolve(recording);
  expect(resolveUri).toHaveBeenCalledWith(source);
  expect(streamCache.get(source.id, "best")).toBe("https://example.org/alternate.mp3");
  expect(streamCache.get(recording.id, "best")).toBeNull();
  await resolve(source);
  expect(resolveUri).toHaveBeenCalledTimes(1);
});
