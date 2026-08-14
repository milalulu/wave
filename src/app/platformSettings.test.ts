import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  activeProviders,
  filterProviders,
  getBlockedArtists,
  getBlockedProviders,
  getBlockedTrackIds,
  isArtistBlocked,
  isBlockedProvider,
  isTrackBlocked,
  orderProviders,
  setBlockedProviders,
  toggleBlockedArtist,
  toggleBlockedTrack,
} from "./platformSettings";

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
