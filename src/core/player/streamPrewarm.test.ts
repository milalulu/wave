import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { streamPrewarmer, PREWARM_COUNT, PREWARM_DELAY_MS } from "./streamPrewarm";
import type { Track } from "../types";

function track(id: string, uri = `https://example.com/${id}`): Track {
  return { id, title: id, artist: "a", provider: "youtube", uri } as Track;
}

describe("streamPrewarmer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    streamPrewarmer.setResolver(null);
  });

  afterEach(() => {
    streamPrewarmer.setResolver(null);
    vi.useRealTimers();
  });

  it("resolves only the first tracks after the debounce delay", async () => {
    const resolve = vi.fn(async (_track: Track) => "url");
    streamPrewarmer.setResolver(resolve);
    streamPrewarmer.prewarm([track("1"), track("2"), track("3"), track("4"), track("5")]);

    expect(resolve).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(PREWARM_DELAY_MS);
    expect(resolve).toHaveBeenCalledTimes(PREWARM_COUNT);
    expect(resolve.mock.calls.map((c) => c[0].id)).toEqual(["1", "2", "3"]);
  });

  it("skips tracks without a uri", async () => {
    const resolve = vi.fn(async (_track: Track) => "url");
    streamPrewarmer.setResolver(resolve);
    streamPrewarmer.prewarm([track("1", ""), track("2")]);

    await vi.advanceTimersByTimeAsync(PREWARM_DELAY_MS);
    expect(resolve.mock.calls.map((c) => c[0].id)).toEqual(["2"]);
  });

  it("supersedes the previous batch", async () => {
    const resolve = vi.fn(async (_track: Track) => "url");
    streamPrewarmer.setResolver(resolve);
    streamPrewarmer.prewarm([track("old")]);
    streamPrewarmer.prewarm([track("new")]);

    await vi.advanceTimersByTimeAsync(PREWARM_DELAY_MS);
    expect(resolve.mock.calls.map((c) => c[0].id)).toEqual(["new"]);
  });

  it("does not resolve the same track twice", async () => {
    const resolve = vi.fn(async (_track: Track) => "url");
    streamPrewarmer.setResolver(resolve);
    streamPrewarmer.prewarm([track("1")]);
    await vi.advanceTimersByTimeAsync(PREWARM_DELAY_MS);
    streamPrewarmer.prewarm([track("1")]);
    await vi.advanceTimersByTimeAsync(PREWARM_DELAY_MS);

    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("retries a track whose resolve failed", async () => {
    const resolve = vi.fn(async () => {
      throw new Error("boom");
    });
    streamPrewarmer.setResolver(resolve);
    streamPrewarmer.prewarm([track("1")]);
    await vi.advanceTimersByTimeAsync(PREWARM_DELAY_MS);
    streamPrewarmer.prewarm([track("1")]);
    await vi.advanceTimersByTimeAsync(PREWARM_DELAY_MS);

    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it("does nothing without a resolver", async () => {
    streamPrewarmer.prewarm([track("1")]);
    await vi.advanceTimersByTimeAsync(PREWARM_DELAY_MS);
  });
});
