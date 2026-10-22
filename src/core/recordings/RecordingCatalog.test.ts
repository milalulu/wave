import { describe, expect, it, vi } from "vitest";
import { MemoryStorage } from "../database/MemoryStorage";
import { playbackSource, type Track } from "../types";
import { RecordingCatalog } from "./RecordingCatalog";
import { RecordingStorage } from "./RecordingStorage";
import { sameRecording } from "./matching";

const original: Track = { id: "a:1", provider: "a", uri: "a://1", title: "Song", artist: "Artist", duration: 200 };
const alternate: Track = { ...original, id: "b:2", provider: "b", uri: "b://2", title: "Song (Official Audio)", duration: 202 };

async function setup(base = new MemoryStorage()) {
  const catalog = new RecordingCatalog(base);
  await catalog.init();
  return { base, catalog, storage: new RecordingStorage(base, catalog) };
}

describe("recording preferences", () => {
  it("keeps the original identity and persists the selected source across reloads", async () => {
    const { base, catalog } = await setup();
    const selected = await catalog.select(original, alternate);
    expect(selected).toMatchObject({ id: original.id, title: original.title, playbackSource: alternate });
    const { catalog: reloaded } = await setup(base);
    expect(reloaded.resolve(original)).toEqual(selected);
    expect(reloaded.resolve(alternate)).toEqual(selected);
    await reloaded.select(selected, original);
    expect(playbackSource(reloaded.resolve(alternate))).toEqual(original);
  });

  it("does not change memory or persisted data after a failed write; subsequent selection works", async () => {
    const { base, catalog } = await setup();
    vi.spyOn(base, "saveRecordingGroups").mockRejectedValueOnce(new Error("disk full"));
    await expect(catalog.select(original, alternate)).rejects.toThrow("disk full");
    expect(catalog.resolve(original)).toEqual(original);
    expect(await base.loadRecordingGroups()).toEqual([]);
    await catalog.select(original, alternate);
    expect(playbackSource(catalog.resolve(original))).toEqual(alternate);
  });

  it("serializes concurrent choices without dropping associations", async () => {
    const { base, catalog } = await setup();
    const third = { ...original, id: "c:3", provider: "c" };
    await Promise.all([catalog.select(original, alternate), catalog.select(original, third)]);
    const { catalog: reloaded } = await setup(base);
    expect(reloaded.aliases(original.id)).toEqual([original.id, alternate.id, third.id]);
    expect(playbackSource(reloaded.resolve(alternate)).id).toBe(third.id);
  });

  it("merges explicit associations while retaining existing source aliases", async () => {
    const { catalog } = await setup();
    const third = { ...original, id: "c:3", provider: "c" };
    const fourth = { ...original, id: "d:4", provider: "d" };
    await catalog.select(original, alternate);
    await catalog.select(third, fourth);
    await catalog.select(original, third);
    expect(catalog.id(fourth.id)).toBe(original.id);
    expect(catalog.aliases(original.id)).toHaveLength(4);
  });

  it("preserves legacy likes, playlist positions and actual sources in history", async () => {
    const { base, catalog, storage } = await setup();
    const unrelated = { ...original, id: "other", title: "Other song" };
    await base.addLikedTrack(original);
    await base.addLikedTrack(alternate);
    await base.addPlaylist({ id: "p", name: "Playlist", trackIds: [alternate.id, unrelated.id, original.id], tracks: [alternate, unrelated, original], createdAt: 1, updatedAt: 2 });
    await base.addHistoryEntry({ track: original, playedAt: 10 });
    await base.addHistoryEntry({ track: alternate, playedAt: 20 });
    await catalog.select(original, alternate);
    expect(await storage.isLiked(alternate.id)).toBe(true);
    expect((await storage.getLikedTracks()).map((t) => t.id)).toEqual([original.id]);
    const playlist = await storage.getPlaylist("p");
    expect(playlist?.trackIds).toEqual([original.id, unrelated.id, original.id]);
    expect(playlist?.tracks?.map((t) => t.title)).toEqual([original.title, unrelated.title, original.title]);
    expect((await base.getPlaylist("p"))?.trackIds).toEqual([alternate.id, unrelated.id, original.id]);
    const history = await storage.getHistory();
    expect(history.map((h) => h.playedAt)).toEqual([20, 10]);
    expect(history.map((h) => h.track.id)).toEqual([original.id, original.id]);
    expect(history.map((h) => playbackSource(h.track).id)).toEqual([alternate.id, original.id]);
    await storage.removeLikedTrack(alternate.id);
    expect(await base.getLikedTracks()).toEqual([]);
  });

  it("never automatically groups an unselected result with the same metadata", async () => {
    const { catalog } = await setup();
    expect(catalog.resolve(alternate)).toBe(alternate);
    await expect(catalog.select(original, { ...alternate, title: "Song (Live)" })).rejects.toThrow("different recording");
    expect(catalog.aliases(original.id)).toEqual([original.id]);
  });
});

describe("recording matching", () => {
  it.each(["Song (Live)", "Song Remix", "Song (Remastered)", "Song (Acoustic)", "Song Radio Edit", "Song Part 2"])("rejects %s", (title) => {
    expect(sameRecording(original, { ...alternate, title })).toBe(false);
  });
  it("accepts packaging labels and capitalization but requires the artist", () => {
    expect(sameRecording(original, { ...alternate, artist: "ARTIST" })).toBe(true);
    expect(sameRecording(original, { ...alternate, artist: undefined })).toBe(false);
    expect(sameRecording(original, { ...alternate, artist: "Another artist" })).toBe(false);
  });
  it("rejects significant duration differences and allows an explicitly marked preview", () => {
    expect(sameRecording(original, { ...alternate, duration: 210 })).toBe(false);
    expect(sameRecording(original, { ...alternate, duration: 30 })).toBe(false);
    expect(sameRecording(original, { ...alternate, duration: 30, meta: { preview: true } })).toBe(true);
  });
});
