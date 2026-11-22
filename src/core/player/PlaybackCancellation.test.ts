import { expect, it, vi } from "vitest";
import { PlayerEngine } from "./PlayerEngine";
import { MockAudioAdapter } from "./PlayerAdapter";
import type { Track } from "../types";
const a: Track = { id: "a", title: "A", provider: "local", uri: "asset:///a" };
const b: Track = { ...a, id: "b", uri: "asset:///b" };

it("refreshes a broken stream and resumes the same track without recording a second play", async () => {
  const adapter = new MockAudioAdapter();
  const resolveUri = vi.fn().mockResolvedValueOnce(a.uri).mockResolvedValue("asset:///refreshed");
  const invalidateStream = vi.fn();
  const engine = new PlayerEngine(adapter, { resolveUri, invalidateStream });
  const played = vi.fn();
  engine.on("played", played);
  await engine.playTracks([a]);
  adapter.tick(23);
  adapter.position = 0;
  adapter.fail("network error — stream may have expired, retrying");
  await vi.waitFor(() => expect(engine.snapshot.state).toBe("playing"));
  expect(invalidateStream).toHaveBeenCalledWith(a.id);
  expect(adapter.src).toBe("asset:///refreshed");
  expect(engine.snapshot.position).toBe(23);
  expect(played).toHaveBeenCalledTimes(1);
  engine.destroy();
});

it("keeps the selected track and its position if recovery fails until the listener resumes", async () => {
  const adapter = new MockAudioAdapter();
  let attempts = 0;
  const resolveUri = vi.fn(async (track: Track) => {
    if (track.id === a.id && ++attempts === 2) throw new Error("offline");
    return track.uri;
  });
  const engine = new PlayerEngine(adapter, { resolveUri });
  await engine.playTracks([a, b]);
  adapter.tick(32);
  adapter.fail("HLS stream error: fragLoadError");
  await vi.waitFor(() => expect(engine.snapshot.state).toBe("paused"));
  expect(engine.snapshot.current?.id).toBe(a.id);
  expect(engine.snapshot.position).toBe(32);
  await engine.play();
  expect(engine.snapshot.state).toBe("playing");
  expect(engine.snapshot.position).toBe(32);
  engine.destroy();
});

it("does not restart playback when the listener pauses during a stream refresh", async () => {
  const adapter = new MockAudioAdapter();
  let finish!: (uri: string) => void;
  const resolveUri = vi.fn().mockResolvedValueOnce(a.uri)
    .mockImplementationOnce(() => new Promise<string>((resolve) => { finish = resolve; }));
  const engine = new PlayerEngine(adapter, { resolveUri });
  await engine.playTracks([a]);
  adapter.tick(27);
  adapter.fail("network error");
  await engine.togglePlay();
  finish("asset:///refreshed");
  await Promise.resolve();
  expect(adapter.state).toBe("paused");
  expect(engine.snapshot.position).toBe(27);
  engine.destroy();
});

it.each([false, true])("reconnect resumes an interrupted song only without a user pause (%s)", async (pausedByUser) => {
  const adapter = new MockAudioAdapter();
  const connectivity = { onLine: true };
  vi.stubGlobal("navigator", connectivity);
  const engine = new PlayerEngine(adapter, {
    resolveUri: async () => {
      if (!connectivity.onLine) throw new Error("offline");
      return a.uri;
    },
  });
  try {
    await engine.playTracks([a]);
    adapter.tick(15);
    connectivity.onLine = false;
    adapter.fail("network error");
    await vi.waitFor(() => expect(engine.snapshot.state).toBe("paused"));
    if (pausedByUser) engine.pause();
    connectivity.onLine = true;
    await engine.resumeAfterReconnect();
    expect(engine.snapshot.state).toBe(pausedByUser ? "paused" : "playing");
    expect(engine.snapshot.position).toBe(15);
  } finally {
    engine.destroy();
    vi.unstubAllGlobals();
  }
});

it.each(["pause", "replace"])("late queue continuation respects %s", async (action) => {
  const adapter = new MockAudioAdapter();
  const engine = new PlayerEngine(adapter);
  await engine.playTracks([a]);
  let finish!: (tracks: Track[]) => void;
  engine.setAutoFill(() => new Promise((resolve) => { finish = resolve; }));
  const next = engine.next();
  if (action === "pause") engine.pause();
  else {
    engine.setAutoFill(async () => []);
    await engine.playTracks([b]);
  }
  finish([a]); await next;
  if (action === "pause") expect(adapter.state).toBe("paused");
  else expect(engine.snapshot.current?.id).toBe("b");
  engine.destroy();
});
