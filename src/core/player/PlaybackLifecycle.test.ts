import { expect, it, vi } from "vitest";
import { PlayerEngine } from "./PlayerEngine";
import { OutputRouter } from "./OutputRouter";
import { MockAudioAdapter } from "./PlayerAdapter";
import type { Track } from "../types";

const track = (id: string): Track => ({ id, uri: `u://${id}`, provider: "test", title: id });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

it.each(["pause", "clearQueue", "destroy"] as const)("%s prevents a late resolver from starting audio", async (action) => {
  const audio = new MockAudioAdapter(), output = new OutputRouter(audio);
  const stream = deferred<string>();
  const engine = new PlayerEngine(output, { resolveUri: () => stream.promise });
  const load = vi.spyOn(audio, "load"), play = vi.spyOn(audio, "play");
  const starting = engine.playTrack(track("one"));
  engine[action]();
  stream.resolve("u://late");
  await starting;
  expect(load).not.toHaveBeenCalled();
  expect(play).not.toHaveBeenCalled();
  engine.destroy();
});

it("a newer selection wins even when its resolver completes first", async () => {
  const audio = new MockAudioAdapter(), output = new OutputRouter(audio);
  const first = deferred<string>();
  const engine = new PlayerEngine(output, { resolveUri: (t) => t.id === "one" ? first.promise : Promise.resolve("u://two") });
  const pending = engine.playTrack(track("one"));
  await engine.playTrack(track("two"));
  first.resolve("u://obsolete");
  await pending;
  expect(audio.src).toBe("u://two");
  expect(engine.snapshot.current?.id).toBe("two");
  expect(engine.snapshot.state).toBe("playing");
  engine.destroy();
});

it("output refresh stays bound to the loaded track while a new selection is resolving", async () => {
  const audio = new MockAudioAdapter(), output = new OutputRouter(audio), remote = new MockAudioAdapter();
  const second = deferred<string>();
  const resolver = vi.fn((t: Track) => t.id === "one" ? Promise.resolve("u://fresh-one") : second.promise);
  const engine = new PlayerEngine(output, { resolveUri: resolver });
  await engine.playTrack(track("one"));
  const selecting = engine.playTrack(track("two"));
  await output.switchTo(remote);
  expect(remote.src).toBe("u://fresh-one");
  second.resolve("u://two");
  await selecting;
  expect(remote.src).toBe("u://two");
  expect(engine.snapshot.current?.id).toBe("two");
  engine.destroy();
});

it("records startup phases and cancellation without including stream URLs", async () => {
  let now = 0;
  const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
  const audio = new MockAudioAdapter(), output = new OutputRouter(audio);
  const engine = new PlayerEngine(output, { resolveUri: async () => { now += 120; return "u://private-token"; } });
  const timings = vi.fn();
  engine.on("startup", timings);
  audio.load = async () => { now += 30; };
  audio.play = async () => { now += 50; };
  try {
    await engine.playTrack(track("one"));
    expect(timings).toHaveBeenCalledWith({ provider: "test", outcome: "playing", totalMs: 200,
      phases: { resolve: 120, validate: 0, load: 30, play: 50 } });
    expect(JSON.stringify(timings.mock.calls)).not.toContain("private-token");
  } finally {
    engine.destroy();
    clock.mockRestore();
  }
});
