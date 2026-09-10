import { describe, expect, it } from "vitest";
import type { Playlist } from "../types";
import { distinctCovers, groupPlaylistsByFolder } from "./playlistGroups";

const pl = (id: string, name: string, folder?: string): Playlist => ({
  id,
  name,
  trackIds: [],
  createdAt: 0,
  updatedAt: 0,
  ...(folder === undefined ? {} : { folder }),
});

describe("groupPlaylistsByFolder", () => {
  it("кладёт беспапочные первыми, папки сортирует", () => {
    const out = groupPlaylistsByFolder([
      pl("1", "B", "work"),
      pl("2", "solo"),
      pl("3", "A", "chill"),
      pl("4", "C", "work"),
    ]);
    expect(out.map((g) => g.folder)).toEqual([null, "chill", "work"]);
    expect(out[0].playlists.map((p) => p.id)).toEqual(["2"]);
    expect(out[2].playlists.map((p) => p.id)).toEqual(["1", "4"]);
  });

  it("пустые и пробельные папки считаются отсутствием", () => {
    const out = groupPlaylistsByFolder([pl("1", "A", "  ")]);
    expect(out).toHaveLength(1);
    expect(out[0].folder).toBeNull();
  });

  it("пустой вход — пустой выход", () => {
    expect(groupPlaylistsByFolder([])).toEqual([]);
  });
});

describe("distinctCovers", () => {
  it("дедуплицирует и режет лимитом", () => {
    const tracks = [
      { coverUrl: "a" },
      { coverUrl: "b" },
      { coverUrl: "a" },
      {},
      { coverUrl: "c" },
    ];
    expect(distinctCovers(tracks)).toEqual(["a", "b", "c"]);
    expect(distinctCovers(tracks, 2)).toEqual(["a", "b"]);
  });
});
