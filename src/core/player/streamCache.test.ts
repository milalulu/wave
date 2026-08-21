import { afterEach, describe, expect, it, vi } from "vitest";
import { streamCache } from "./streamCache";

afterEach(() => {
  streamCache.clear();
  vi.useRealTimers();
});

describe("streamCache", () => {
  it("does not return a url cached for another quality", () => {
    streamCache.set("youtube:track:a", "https://a.test/x", "best");
    expect(streamCache.get("youtube:track:a", "best")).toBe("https://a.test/x");
    expect(streamCache.get("youtube:track:a", "low")).toBeNull();
  });

  it("expires shortly before the expire param of the url", () => {
    vi.useFakeTimers();
    const expireSec = Math.floor(Date.now() / 1000) + 5 * 60;
    streamCache.set("youtube:track:b", `https://r1.googlevideo.com/videoplayback?expire=${expireSec}`);
    expect(streamCache.get("youtube:track:b")).not.toBeNull();
    vi.advanceTimersByTime(4 * 60 * 1000);
    expect(streamCache.get("youtube:track:b")).toBeNull();
  });

  it("reads the expire param through the local audio proxy url", () => {
    vi.useFakeTimers();
    const expireSec = Math.floor(Date.now() / 1000) + 5 * 60;
    const raw = `https://r1.googlevideo.com/videoplayback?expire=${expireSec}`;
    streamCache.set("youtube:track:c", `http://127.0.0.1:8299/audio?url=${encodeURIComponent(raw)}`);
    vi.advanceTimersByTime(4 * 60 * 1000);
    expect(streamCache.get("youtube:track:c")).toBeNull();
  });

  it("falls back to the default ttl when the url carries no expiry", () => {
    vi.useFakeTimers();
    streamCache.set("soundcloud:track:d", "https://cf-media.sndcdn.com/stream.mp3");
    vi.advanceTimersByTime(44 * 60 * 1000);
    expect(streamCache.get("soundcloud:track:d")).toBe("https://cf-media.sndcdn.com/stream.mp3");
    vi.advanceTimersByTime(2 * 60 * 1000);
    expect(streamCache.get("soundcloud:track:d")).toBeNull();
  });
});
