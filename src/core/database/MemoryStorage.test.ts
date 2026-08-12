import { describe, expect, it } from "vitest";
import type { Track } from "../types";
import { MemoryStorage } from "./MemoryStorage";
import { HistoryService } from "../library/HistoryService";
import { LibraryService } from "../library/LibraryService";

const track: Track = { id: "t1", provider: "test", uri: "u://1", title: "One", genre: "rock" };
const track2: Track = { id: "t2", provider: "test", uri: "u://2", title: "Two" };

describe("MemoryStorage + services", () => {
  it("likes and unlikes tracks", async () => {
    const storage = new MemoryStorage();
    await storage.init();
    const lib = new LibraryService(storage);
    expect(await lib.isLiked(track)).toBe(false);
    expect(await lib.toggleLike(track)).toBe(true);
    expect(await lib.isLiked(track)).toBe(true);
    expect((await lib.getLikedTracks()).map((t) => t.id)).toEqual(["t1"]);
    expect(await lib.toggleLike(track)).toBe(false);
    expect(await lib.isLiked(track)).toBe(false);
  });

  it("records and reads history (newest first)", async () => {
    const storage = new MemoryStorage();
    const history = new HistoryService(storage);
    await history.recordPlay(track, 1000);
    await history.recordPlay(track2, 2000);
    const entries = await history.getHistory();
    expect(entries.map((e) => e.track.id)).toEqual(["t2", "t1"]);
    const limited = await history.getHistory(1);
    expect(limited.map((e) => e.track.id)).toEqual(["t2"]);
    await history.clear();
    expect(await history.getHistory()).toEqual([]);
  });

  it("saves and removes albums and artists", async () => {
    const storage = new MemoryStorage();
    const lib = new LibraryService(storage);
    const album = { id: "al1", provider: "test", title: "Album" };
    const artist = { id: "ar1", provider: "test", name: "Artist" };
    expect(await lib.toggleSaveAlbum(album)).toBe(true);
    expect(await lib.toggleSaveAlbum(album)).toBe(false);
    expect(await lib.getSavedAlbums()).toEqual([]);
    expect(await lib.toggleSaveArtist(artist)).toBe(true);
    expect((await lib.getSavedArtists()).map((a) => a.id)).toEqual(["ar1"]);
  });
});
