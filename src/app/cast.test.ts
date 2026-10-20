import { afterEach, beforeEach, it, expect, vi } from "vitest";
import { NativeCastAdapter } from "./cast";
import { invoke } from "@tauri-apps/api/core";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(invoke).mockReset();
});
afterEach(() => vi.useRealTimers());
it("serializes seek before play and emits receiver progress and completion", async () => {
  vi.mocked(invoke).mockImplementation(async (command) =>
    command === "cast_status"
      ? {
          state: "idle",
          position: 100,
          duration: 100,
          finished: true,
          failed: false,
        }
      : undefined,
  );
  const adapter = new NativeCastAdapter(7, vi.fn()),
    ended = vi.fn(),
    time = vi.fn();
  adapter.onEnded(ended);
  adapter.onTimeUpdate(time);
  await adapter.load("song");
  adapter.seek(20);
  await adapter.play();
  await vi.advanceTimersByTimeAsync(1000);
  const actions = vi
    .mocked(invoke)
    .mock.calls.filter(([c]) => c === "cast_control")
    .map(([, a]) => (a as { action: string }).action);
  expect(actions).toEqual(["seek", "play"]);
  expect(time).toHaveBeenCalledWith(100, 100);
  expect(ended).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(3000);
  expect(ended).toHaveBeenCalledOnce();
  adapter.destroy();
});
it("drops a stale status response after loading another track", async () => {
  let finish!: (v: unknown) => void;
  vi.mocked(invoke).mockImplementation((command) =>
    command === "cast_status"
      ? new Promise((r) => {
          finish = r;
        })
      : Promise.resolve(undefined),
  );
  const adapter = new NativeCastAdapter(8, vi.fn()),
    ended = vi.fn();
  adapter.onEnded(ended);
  await adapter.load("one");
  await vi.advanceTimersByTimeAsync(1000);
  await adapter.load("two");
  finish({
    state: "idle",
    position: 100,
    duration: 100,
    finished: true,
    failed: false,
  });
  await Promise.resolve();
  expect(ended).not.toHaveBeenCalled();
  adapter.destroy();
});
it("reports connection loss once and stops polling after destruction", async () => {
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "cast_status") throw new Error("connection lost");
  });
  const lost = vi.fn(),
    adapter = new NativeCastAdapter(9, lost);
  await adapter.load("one");
  await vi.advanceTimersByTimeAsync(1000);
  expect(lost).toHaveBeenCalledOnce();
  adapter.destroy();
  const calls = vi.mocked(invoke).mock.calls.length;
  await vi.advanceTimersByTimeAsync(5000);
  expect(invoke).toHaveBeenCalledTimes(calls);
  expect(invoke).toHaveBeenCalledWith("cast_disconnect", { id: 9 });
});
