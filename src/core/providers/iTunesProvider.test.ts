import { afterEach, describe, expect, it, vi } from "vitest";
import type { SearchResults } from "../types";
import { iTunesProvider } from "./iTunesProvider";
import { LocalProvider, type LocalSource } from "./LocalProvider";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("iTunesProvider", () => {
  it("parses search results", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        results: [
          {
            wrapperType: "track",
            trackId: 1,
            trackName: "Bohemian Rhapsody",
            artistName: "Queen",
            collectionName: "A Night at the Opera",
            artworkUrl100: "http://x/100x100bb.jpg",
            previewUrl: "http://x/preview.m4a",
            trackTimeMillis: 354000,
            primaryGenreName: "Rock",
            releaseDate: "1975-10-31T00:00:00Z",
          },
          {
            wrapperType: "collection",
            collectionId: 10,
            collectionName: "A Night at the Opera",
            artistName: "Queen",
            artworkUrl100: "http://x/100x100bb.jpg",
            releaseDate: "1975-10-31T00:00:00Z",
            trackCount: 12,
          },
          {
            wrapperType: "artist",
            artistId: 100,
            artistName: "Queen",
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new iTunesProvider();
    const results: SearchResults = await provider.search("queen");
    expect(results.tracks).toHaveLength(1);
    const track = results.tracks[0];
    expect(track.id).toBe("itunes:track:1");
    expect(track.title).toBe("Bohemian Rhapsody");
    expect(track.artist).toBe("Queen");
    expect(track.duration).toBe(354);
    expect(track.genre).toBe("Rock");
    expect(track.coverUrl).toContain("300x300bb");
    expect(results.albums).toHaveLength(1);
    expect(results.albums[0].id).toBe("itunes:album:10");
    expect(results.artists).toHaveLength(1);
    expect(results.artists[0].name).toBe("Queen");
    expect(fetchMock).toHaveBeenCalledOnce();
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("media=music");
  });

  it("skips tracks without preview", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ results: [{ wrapperType: "track", trackId: 5, trackName: "NoPreview" }] }),
      }),
    );
    const provider = new iTunesProvider();
    const results = await provider.search("x");
    expect(results.tracks).toHaveLength(0);
  });
});

describe("LocalProvider", () => {
  it("opens directory, maps files to asset uris and searches", async () => {
    const source: LocalSource = {
      pickDirectory: async () => "/mnt/music",
      listMusicFiles: async () => [
        { path: "/mnt/music/Queen - Bohemian Rhapsody.mp3", duration: 354 },
      ],
      toUri: (p: string) => `asset://${p}`,
    };
    const provider = new LocalProvider(source);
    const tracks = await provider.openDirectory();
    expect(provider.directory).toBe("/mnt/music");
    expect(tracks).toHaveLength(1);
    expect(tracks[0].uri).toBe("asset:///mnt/music/Queen - Bohemian Rhapsody.mp3");
    expect(tracks[0].title).toBe("Queen - Bohemian Rhapsody");
    const results = await provider.search("bohemian");
    expect(results.tracks).toHaveLength(1);
    const none = await provider.search("zzz");
    expect(none.tracks).toHaveLength(0);
  });
});