import { create } from "zustand";
import { expect, it, vi } from "vitest";
import type { AppState } from "./stores";
import { createVariantsSlice } from "./variantsSlice";
import { findTrackVariants } from "./trackVariants";
import { MemoryStorage } from "../core/database/MemoryStorage";
import { RecordingCatalog } from "../core/recordings/RecordingCatalog";
import { playbackSource, type Track } from "../core/types";

vi.mock("./trackVariants", () => ({ findTrackVariants: vi.fn().mockResolvedValue([]) }));
const original: Track = { id: "a", provider: "first", uri: "u://a", title: "Song", artist: "Artist" };
const alternate = { ...original, id: "b", provider: "second", uri: "u://b" };
async function setup() {
  const base = new MemoryStorage();
  const recordings = new RecordingCatalog(base);
  await recordings.init();
  const engine = { snapshot: { current: original }, playVariant: vi.fn() };
  const store = create<AppState>((...args) => ({
    ...createVariantsSlice(...args), services: { recordings, engine, providers: [] },
    refreshLibrary: vi.fn().mockResolvedValue(undefined), loadPlaylists: vi.fn().mockResolvedValue(undefined), notify: vi.fn(),
  } as unknown as AppState));
  return { base, recordings, engine, store };
}

it("saves before applying a source and asks the player to preserve its position", async () => {
  const { store, engine, recordings } = await setup();
  await store.getState().playVariant({ providerId: alternate.provider, track: alternate });
  expect(engine.playVariant).toHaveBeenCalledWith(recordings.resolve(original), true);
  expect(store.getState().variantSaving).toBe(false);
});

it("does not replace a different song selected while a preference was being written", async () => {
  const { base, store, engine, recordings } = await setup();
  let finish!: () => void;
  vi.spyOn(base, "saveRecordingGroups").mockImplementationOnce(() => new Promise<void>((r) => { finish = r; }));
  const pending = store.getState().playVariant({ providerId: alternate.provider, track: alternate });
  await vi.waitFor(() => expect(finish).toBeDefined());
  engine.snapshot.current = { ...original, id: "other", title: "Another song" };
  finish();
  await pending;
  expect(engine.playVariant).not.toHaveBeenCalled();
  expect(playbackSource(recordings.resolve(original))).toEqual(alternate);
});

it("reports a failed save without changing playback", async () => {
  const { base, store, engine } = await setup();
  vi.spyOn(base, "saveRecordingGroups").mockRejectedValueOnce(new Error("disk full"));
  await store.getState().playVariant({ providerId: alternate.provider, track: alternate });
  expect(engine.playVariant).not.toHaveBeenCalled();
  expect(store.getState().notify).toHaveBeenCalledWith("disk full");
  expect(store.getState().variantSaving).toBe(false);
});

it("includes the original source after selection and ignores stale search results", async () => {
  const { recordings, store } = await setup();
  await recordings.select(original, alternate);
  let finish!: (v: Awaited<ReturnType<typeof findTrackVariants>>) => void;
  vi.mocked(findTrackVariants).mockImplementationOnce(() => new Promise((r) => { finish = r; }));
  const first = store.getState().loadVariants(recordings.resolve(original));
  expect(store.getState().variants.map((v) => v.track.id)).toEqual([original.id, alternate.id]);
  const other = { ...original, id: "other", title: "Other song" };
  await store.getState().loadVariants(other);
  finish([{ providerId: alternate.provider, track: alternate }]);
  await first;
  expect(store.getState().variants.map((v) => v.track.id)).toEqual([other.id]);
  expect(store.getState().variantsLoading).toBe(false);
});
