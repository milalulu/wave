import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MusicProvider } from "../core/providers/MusicProvider";
import type { Track } from "../core/types";
import {
  clearVariantsCache,
  findTrackVariants,
  isVariantOf,
} from "./trackVariants";
import { setPreferredProviders } from "./platformSettings";

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

const track: Track = {
  id: "cur",
  provider: "deezer",
  uri: "u://cur",
  title: "Bohemian Rhapsody",
  artist: "Queen",
};

function provider(id: string, tracks: Track[]): MusicProvider {
  return {
    id,
    name: id,
    enabled: true,
    search: vi.fn(async () => ({ tracks })),
  } as unknown as MusicProvider;
}

beforeEach(() => {
  vi.stubGlobal("localStorage", makeStorage());
  clearVariantsCache();
});

describe("isVariantOf", () => {
  it("matches exact title and artist", () => {
    expect(isVariantOf({ title: "Bohemian Rhapsody", artist: "Queen" } as Track, track)).toBe(true);
  });

  it("matches case-insensitively", () => {
    expect(isVariantOf({ title: "bohemian rhapsody", artist: "QUEEN" } as Track, track)).toBe(true);
  });

  it("matches fuzzy title containment", () => {
    expect(isVariantOf({ title: "Bohemian Rhapsody (Remastered)", artist: "Queen" } as Track, track)).toBe(true);
  });

  it("rejects different artist", () => {
    expect(isVariantOf({ title: "Bohemian Rhapsody", artist: "Other" } as Track, track)).toBe(false);
  });

  it("rejects empty titles", () => {
    expect(isVariantOf({ title: "", artist: "Queen" } as Track, track)).toBe(false);
  });
});

describe("findTrackVariants", () => {
  it("skips the current provider and non-variant sources", async () => {
    const pItunes = provider("itunes", [
      { id: "i1", provider: "itunes", uri: "u://i1", title: "Bohemian Rhapsody", artist: "Queen" },
    ]);
    const pDeezer = provider("deezer", [
      { id: "d1", provider: "deezer", uri: "u://d1", title: "Bohemian Rhapsody", artist: "Queen" },
    ]);
    const pLocal = provider("local", []);
    const pMb = provider("musicbrainz", []);

    const variants = await findTrackVariants([pItunes, pDeezer, pLocal, pMb], track);

    expect(variants.map((v) => v.providerId)).toEqual(["itunes"]);
    expect(pDeezer.search).not.toHaveBeenCalled();
    expect(pLocal.search).not.toHaveBeenCalled();
    expect(pMb.search).not.toHaveBeenCalled();
  });

  it("skips non-playable tracks and dedupes by id", async () => {
    const pItunes = provider("itunes", [
      { id: "i1", provider: "itunes", uri: "u://i1", title: "Bohemian Rhapsody", artist: "Queen", meta: { noPlay: true } },
      { id: "i2", provider: "itunes", uri: "u://i2", title: "Bohemian Rhapsody", artist: "Queen" },
      { id: "i2", provider: "itunes", uri: "u://i2", title: "Bohemian Rhapsody", artist: "Queen" },
    ]);

    const variants = await findTrackVariants([pItunes], track);

    expect(variants.map((v) => v.track.id)).toEqual(["i2"]);
  });

  it("caches results per track and orders by preference", async () => {
    setPreferredProviders(["youtube", "itunes"]);
    const pItunes = provider("itunes", [
      { id: "i1", provider: "itunes", uri: "u://i1", title: "Bohemian Rhapsody", artist: "Queen" },
    ]);
    const pYt = provider("youtube", [
      { id: "y1", provider: "youtube", uri: "u://y1", title: "Bohemian Rhapsody", artist: "Queen" },
    ]);

    const first = await findTrackVariants([pItunes, pYt], track);
    const second = await findTrackVariants([pItunes, pYt], track);

    expect(first.map((v) => v.providerId)).toEqual(["youtube", "itunes"]);
    expect(second).toEqual(first);
    expect(pYt.search).toHaveBeenCalledTimes(1);
    expect(pItunes.search).toHaveBeenCalledTimes(1);
  });

  it("returns empty for a track without a title", async () => {
    const noTitle: Track = { id: "x", provider: "deezer", uri: "u://x", title: "" };
    const pItunes = provider("itunes", []);
    expect(await findTrackVariants([pItunes], noTitle)).toEqual([]);
    expect(pItunes.search).not.toHaveBeenCalled();
  });
});
