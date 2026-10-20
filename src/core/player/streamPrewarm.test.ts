import { afterEach, it, expect, vi } from "vitest";
import { StreamPrewarmer } from "./streamPrewarm";
import type { Track } from "../types";
const track = (id: string): Track => ({
  id,
  title: id,
  provider: "youtube",
  uri: id,
});
afterEach(() => vi.useRealTimers());
it("debounces lists and limits work to three playable tracks", async () => {
  vi.useFakeTimers();
  const resolve = vi.fn(async () => "url"),
    warm = new StreamPrewarmer(resolve);
  warm.prewarm([track("old")]);
  warm.prewarm([track("1"), track("2"), track("3"), track("4")]);
  await vi.advanceTimersByTimeAsync(500);
  expect(resolve.mock.calls).toHaveLength(3);
});
it("never overlaps background resolves when a list changes during a request", async () => {
  vi.useFakeTimers();
  let finish!: (url: string) => void;
  const resolve = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<string>((r) => {
            finish = r;
          }),
      )
      .mockResolvedValue("url"),
    warm = new StreamPrewarmer(resolve);
  warm.prewarm([track("old"), track("stale")]);
  await vi.advanceTimersByTimeAsync(500);
  warm.prewarm([track("new")]);
  await vi.advanceTimersByTimeAsync(500);
  expect(resolve).toHaveBeenCalledTimes(1);
  finish("url");
  await vi.advanceTimersByTimeAsync(0);
  expect(resolve.mock.calls.map(([t]) => t.id)).toEqual(["old", "new"]);
});
it("revisits the shared resolver so expired and different-quality URLs can refresh", async () => {
  vi.useFakeTimers();
  const resolve = vi.fn(async () => "url"),
    warm = new StreamPrewarmer(resolve);
  warm.prewarm([track("1")]);
  await vi.advanceTimersByTimeAsync(500);
  warm.prewarm([track("1")]);
  await vi.advanceTimersByTimeAsync(500);
  expect(resolve).toHaveBeenCalledTimes(2);
  warm.prewarm([track("2")]);
  warm.cancel();
  await vi.advanceTimersByTimeAsync(500);
  expect(resolve).toHaveBeenCalledTimes(2);
});
