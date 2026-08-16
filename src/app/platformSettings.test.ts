import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  activeProviders,
  filterPreviewResults,
  filterProviders,
  getBlockedArtists,
  getBlockedProviders,
  getBlockedTrackIds,
  isArtistBlocked,
  isBlockedProvider,
  isExcludePreviewsEnabled,
  isPreviewTrack,
  isTrackBlocked,
  orderProviders,
  setBlockedProviders,
  setExcludePreviewsEnabled,
  toggleBlockedArtist,
  toggleBlockedTrack,
} from "./platformSettings";
import type { SearchResults, Track } from "../core/types";

function makeStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return [...store.keys()][index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

beforeEach(() => {
  vi.stubGlobal("localStorage", makeStorage());
});

const providers = [
  { id: "deezer" },
  { id: "itunes" },
  { id: "youtube" },
  { id: "local" },
];

describe("platformSettings providers", () => {
  it("round-trips blocked providers and dedupes", () => {
    setBlockedProviders(["youtube", "deezer", "youtube"]);
    expect(getBlockedProviders()).toEqual(["youtube", "deezer"]);
    expect(isBlockedProvider("youtube")).toBe(true);
    expect(isBlockedProvider("spotify")).toBe(false);
  });

  it("filterProviders removes blocked", () => {
    setBlockedProviders(["youtube"]);
    expect(filterProviders(providers).map((p) => p.id)).toEqual(["deezer", "itunes", "local"]);
  });

  it("orderProviders respects preferred order and keeps unknown last", () => {
    const ordered = orderProviders(providers, ["local", "youtube"]);
    expect(ordered.map((p) => p.id)).toEqual(["local", "youtube", "deezer", "itunes"]);
  });

  it("orderProviders without saved preference keeps order", () => {
    expect(orderProviders(providers).map((p) => p.id)).toEqual([
      "deezer",
      "itunes",
      "youtube",
      "local",
    ]);
  });

  it("activeProviders applies blocking then preference", () => {
    setBlockedProviders(["itunes"]);
    const active = activeProviders(providers);
    expect(active.map((p) => p.id)).toEqual(["deezer", "youtube", "local"]);
  });
});

describe("platformSettings track/artist blocking", () => {
  it("toggles a blocked track and reports state", () => {
    expect(isTrackBlocked("trk-1")).toBe(false);
    expect(toggleBlockedTrack("trk-1")).toBe(true);
    expect(isTrackBlocked("trk-1")).toBe(true);
    expect(toggleBlockedTrack("trk-1")).toBe(false);
    expect(isTrackBlocked("trk-1")).toBe(false);
  });

  it("persists blocked track ids", () => {
    toggleBlockedTrack("trk-2");
    expect(getBlockedTrackIds()).toEqual(["trk-2"]);
  });

  it("normalizes artist names to lowercase and trims", () => {
    expect(toggleBlockedArtist("  Queen  ")).toBe(true);
    expect(getBlockedArtists()).toEqual(["queen"]);
    expect(isArtistBlocked("QUEEN")).toBe(true);
    expect(isArtistBlocked("queen")).toBe(true);
    expect(isArtistBlocked("Elton John")).toBe(false);
    expect(toggleBlockedArtist("Queen")).toBe(false);
    expect(isArtistBlocked("queen")).toBe(false);
  });

  it("ignores empty artist names", () => {
    expect(toggleBlockedArtist("   ")).toBe(false);
    expect(isArtistBlocked()).toBe(false);
  });
});

describe("platformSettings preview filter", () => {
  const track = (id: string, provider: string, preview?: boolean): Track => ({
    id,
    provider,
    uri: "x.mp3",
    title: id,
    ...(preview !== undefined ? { meta: { preview } } : {}),
  });
  const results = (tracks: Track[]): SearchResults[] => [
    { provider: "a", tracks, albums: [], artists: [] },
  ];

  it("распознаёт превью по площадке (iTunes/Deezer)", () => {
    expect(isPreviewTrack(track("1", "itunes"))).toBe(true);
    expect(isPreviewTrack(track("2", "deezer"))).toBe(true);
  });

  it("распознаёт превью по meta.preview (Spotify с preview_url)", () => {
    expect(isPreviewTrack(track("3", "spotify", true))).toBe(true);
    expect(isPreviewTrack(track("4", "spotify"))).toBe(false);
    expect(isPreviewTrack(track("5", "youtube"))).toBe(false);
  });

  it("фильтр убирает превью, но оставляет альбомы и артистов", () => {
    const mixed: SearchResults[] = [
      {
        provider: "a",
        tracks: [track("1", "itunes"), track("2", "youtube")],
        albums: [{ id: "al1", provider: "a", title: "Album" }],
        artists: [{ id: "ar1", provider: "a", name: "Artist" }],
      },
    ];
    const filtered = filterPreviewResults(mixed, true);
    expect(filtered[0].tracks.map((t) => t.id)).toEqual(["2"]);
    expect(filtered[0].albums).toHaveLength(1);
    expect(filtered[0].artists).toHaveLength(1);
  });

  it("при выключенном фильтре результаты не меняются", () => {
    const input = results([track("1", "itunes"), track("2", "deezer")]);
    expect(filterPreviewResults(input, false)).toEqual(input);
  });

  it("исключение превью включено по умолчанию и переключается", () => {
    expect(isExcludePreviewsEnabled()).toBe(true);
    setExcludePreviewsEnabled(false);
    expect(isExcludePreviewsEnabled()).toBe(false);
    setExcludePreviewsEnabled(true);
    expect(isExcludePreviewsEnabled()).toBe(true);
  });
});
