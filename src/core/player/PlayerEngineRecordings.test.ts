import { afterEach, expect, it, vi } from "vitest";
import { MemoryStorage } from "../database/MemoryStorage";
import { RecordingCatalog } from "../recordings/RecordingCatalog";
import { playbackSource, type Track } from "../types";
import { MockAudioAdapter } from "./PlayerAdapter";
import { PlayerEngine } from "./PlayerEngine";

const original: Track = { id: "a", provider: "first", uri: "u://a", title: "Song", artist: "Artist", duration: 200 };
const alternate: Track = { ...original, id: "b", provider: "second", uri: "u://b" };
let engine: PlayerEngine;
afterEach(() => engine?.destroy());
async function setup() {
  const catalog = new RecordingCatalog(new MemoryStorage());
  await catalog.init();
  const adapter = new MockAudioAdapter();
  engine = new PlayerEngine(adapter, { prepareTrack: (t) => catalog.resolve(t), retries: 0 });
  return { catalog, adapter };
}

it("uses the preferred source on playback and restore, preserving the queue identity", async () => {
  const { catalog, adapter } = await setup();
  await catalog.select(original, alternate);
  await engine.playTracks([original]);
  expect(adapter.src).toBe(alternate.uri);
  expect(engine.snapshot.current?.id).toBe(original.id);
  await engine.restoreQueue([alternate], 0, 42);
  await engine.play();
  expect(adapter.src).toBe(alternate.uri);
  expect(adapter.position).toBe(42);
  expect(engine.snapshot.current?.id).toBe(original.id);
});

it("preserves position when switching a playing recording", async () => {
  const { catalog, adapter } = await setup();
  await engine.playTrack(original);
  adapter.seek(53);
  engine.playVariant(await catalog.select(original, alternate), true);
  await vi.waitFor(() => expect(adapter.src).toBe(alternate.uri));
  expect(adapter.position).toBe(53);
  expect(engine.snapshot.state).toBe("playing");
  expect(engine.snapshot.current?.id).toBe(original.id);
});

it("keeps a paused recording paused and resumes the new source at the same position", async () => {
  const { catalog, adapter } = await setup();
  await engine.playTrack(original);
  adapter.seek(47);
  engine.pause();
  engine.playVariant(await catalog.select(original, alternate), true);
  expect(engine.snapshot.state).toBe("paused");
  expect(adapter.state).toBe("paused");
  await engine.play();
  expect(adapter.src).toBe(alternate.uri);
  expect(adapter.position).toBe(47);
});

it("does not overwrite a temporary fallback with a saved but failing source", async () => {
  const { catalog, adapter } = await setup();
  await catalog.select(original, alternate);
  const load = vi.spyOn(adapter, "load").mockImplementation(async (uri) => {
    if (uri === alternate.uri) throw new Error("unavailable");
    adapter.src = uri;
  });
  engine.setFallback(() => catalog.withSource(original, original));
  await engine.playTrack(original);
  await vi.waitFor(() => expect(engine.snapshot.state).toBe("playing"));
  expect(adapter.src).toBe(original.uri);
  expect(load).toHaveBeenCalledTimes(2);
  expect(playbackSource(catalog.resolve(original)).id).toBe(alternate.id);
  expect(engine.snapshot.current?.id).toBe(original.id);
});

it("re-resolves a restored source instead of reusing an old adapter or expiring URL", async () => {
  const { catalog, adapter } = await setup();
  engine.destroy();
  const resolveUri = vi.fn(async (t: Track) => `u://fresh-${playbackSource(t).id}`);
  engine = new PlayerEngine(adapter, { prepareTrack: (t) => catalog.resolve(t), resolveUri });
  await engine.playTrack(original);
  await catalog.select(original, { ...alternate, uri: "https://example.org/expired.mp3" });
  await engine.restoreQueue([original], 0, 35);
  expect(engine.snapshot.state).toBe("paused");
  await engine.play();
  expect(adapter.src).toBe("u://fresh-b");
  expect(adapter.position).toBe(35);
  expect(resolveUri).toHaveBeenCalledTimes(2);
});
