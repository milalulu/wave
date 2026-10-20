import { beforeEach, it, expect, vi } from "vitest";
import { createStreamResolver } from "./streamResolver";
import { streamCache } from "../core/player/streamCache";
import type { MusicProvider } from "../core/providers/MusicProvider";
import type { Track } from "../core/types";
const flags = vi.hoisted(() => ({
  offline: false,
  blocked: false,
  quality: "best",
}));
vi.mock("./offline", () => ({
  offlineEnabled: () => flags.offline,
  localUriFor: () => null,
}));
vi.mock("./platformSettings", () => ({
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
