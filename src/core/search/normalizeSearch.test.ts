import { describe, expect, it } from "vitest";
import type { Album, Artist, SearchResults, Track } from "../types";
import {
  normalizeTitle,
  normalizeArtist,
  normalizeSearchResults,
  rankTracks,
} from "./normalizeSearch";

function track(overrides: Partial<Track> & { title: string; provider: string; id: string }): Track {
  return {
    uri: "",
    artist: "",
    ...overrides,
  };
}

function album(overrides: Partial<Album> & { title: string; provider: string; id: string }): Album {
  return { ...overrides };
}

function artist(overrides: Partial<Artist> & { name: string; provider: string; id: string }): Artist {
  return { ...overrides };
}

describe("normalizeTitle", () => {
  it("strips parenthesized noise", () => {
    expect(normalizeTitle("Hello (Official Video)")).toBe("hello");
    expect(normalizeTitle("Hello [Lyrics]")).toBe("hello");
    expect(normalizeTitle("Hello (Remastered 2023)")).toBe("hello");
    expect(normalizeTitle("Hello (Live at Wembley)")).toBe("hello");
    expect(normalizeTitle("Hello (Acoustic)")).toBe("hello");
  });

  it("strips bracketed noise", () => {
    expect(normalizeTitle("Hello [Official Audio]")).toBe("hello");
    expect(normalizeTitle("Hello [HD]")).toBe("hello");
    expect(normalizeTitle("Hello [4K]")).toBe("hello");
  });

  it("strips mixed noise", () => {
    expect(normalizeTitle("Hello (Official Video) [Lyrics]")).toBe("hello");
    expect(normalizeTitle("Hello {Remastered} (Live)")).toBe("hello");
  });

  it("preserves meaningful content", () => {
    expect(normalizeTitle("Bohemian Rhapsody")).toBe("bohemian rhapsody");
    expect(normalizeTitle("Hotel California")).toBe("hotel california");
  });

  it("normalizes artist - title separator", () => {
    expect(normalizeTitle("Queen - Bohemian Rhapsody")).toBe("queen bohemian rhapsody");
    expect(normalizeTitle("Queen – Bohemian Rhapsody")).toBe("queen bohemian rhapsody");
    expect(normalizeTitle("Queen: Bohemian Rhapsody")).toBe("queen bohemian rhapsody");
  });

  it("strips trailing VEVO / Topic", () => {
    expect(normalizeTitle("Bohemian Rhapsody - Queen VEVO")).toBe("bohemian rhapsody");
    expect(normalizeTitle("Bohemian Rhapsody - Official Topic")).toBe("bohemian rhapsody");
  });

  it("strips remixed / extended tags", () => {
    expect(normalizeTitle("Hello (Extended Mix)")).toBe("hello");
    expect(normalizeTitle("Hello (Radio Edit)")).toBe("hello");
    expect(normalizeTitle("Hello (Sped Up)")).toBe("hello");
    expect(normalizeTitle("Hello (Nightcore)")).toBe("hello");
  });

  it("handles multi-level noise", () => {
    expect(
      normalizeTitle("Bohemian Rhapsody (Remastered 2011) (Official Video) [HD]"),
    ).toBe("bohemian rhapsody");
  });
});

describe("normalizeArtist", () => {
  it("strips - Topic / VEVO suffixes", () => {
    expect(normalizeArtist("Queen - Topic")).toBe("queen");
    expect(normalizeArtist("Queen VEVO")).toBe("queen");
    expect(normalizeArtist("Queen - Topic Records")).toBe("queen");
  });

  it("normalizes case", () => {
    expect(normalizeArtist("THE BEATLES")).toBe("the beatles");
    expect(normalizeArtist("Daft Punk")).toBe("daft punk");
  });

  it("handles empty input", () => {
    expect(normalizeArtist("")).toBe("");
  });
});

describe("deduplication via normalizeSearchResults", () => {
  it("deduplicates same track across providers", () => {
    const results: SearchResults[] = [
      {
        provider: "youtube",
        tracks: [
          track({
            id: "youtube:track:abc123",
            provider: "youtube",
            title: "Bohemian Rhapsody",
            artist: "Queen",
          }),
        ],
        albums: [],
        artists: [],
      },
      {
        provider: "soundcloud",
        tracks: [
          track({
            id: "soundcloud:track:xyz789",
            provider: "soundcloud",
            title: "Bohemian Rhapsody (Official Audio)",
            artist: "Queen",
          }),
        ],
        albums: [],
        artists: [],
      },
    ];

    const out = normalizeSearchResults(results, "Bohemian Rhapsody");
    expect(out).toHaveLength(1);
    expect(out[0].tracks).toHaveLength(1);
    expect(out[0].tracks[0].id).toBe("youtube:track:abc123");
    const meta = out[0].tracks[0].meta as { alternatives?: { id: string }[] };
    expect(meta.alternatives).toHaveLength(1);
    expect(meta.alternatives![0].id).toBe("soundcloud:track:xyz789");
  });

  it("deduplicates albums across providers", () => {
    const results: SearchResults[] = [
      {
        provider: "deezer",
        tracks: [],
        albums: [
          album({ id: "deezer:album:1", provider: "deezer", title: "A Night at the Opera", artist: "Queen" }),
        ],
        artists: [],
      },
      {
        provider: "itunes",
        tracks: [],
        albums: [
          album({ id: "itunes:album:2", provider: "itunes", title: "A Night at the Opera (Remastered)", artist: "Queen" }),
        ],
        artists: [],
      },
    ];

    const out = normalizeSearchResults(results, "A Night at the Opera");
    expect(out).toHaveLength(1);
    expect(out[0].albums).toHaveLength(1);
  });

  it("deduplicates artists across providers", () => {
    const results: SearchResults[] = [
      {
        provider: "deezer",
        tracks: [],
        albums: [],
        artists: [
          artist({ id: "deezer:artist:1", provider: "deezer", name: "Queen" }),
        ],
      },
      {
        provider: "spotify",
        tracks: [],
        albums: [],
        artists: [
          artist({ id: "spotify:artist:2", provider: "spotify", name: "Queen" }),
        ],
      },
    ];

    const out = normalizeSearchResults(results, "Queen");
    expect(out).toHaveLength(1);
    expect(out[0].artists).toHaveLength(1);
  });
});

describe("ranking", () => {
  it("ranks exact title match first", () => {
    const tracks = [
      track({ id: "1", provider: "youtube", title: "Bohemian Rhapsody - Live", artist: "Queen" }),
      track({ id: "2", provider: "deezer", title: "Bohemian Rhapsody", artist: "Queen" }),
      track({ id: "3", provider: "spotify", title: "Random Song", artist: "Queen" }),
    ];

    const ranked = rankTracks(tracks, "Bohemian Rhapsody");
    expect(ranked[0].id).toBe("2");
  });

  it("prefers full playback over preview", () => {
    const tracks = [
      track({ id: "1", provider: "itunes", title: "Hello", artist: "Adele", meta: { preview: true } }),
      track({ id: "2", provider: "youtube", title: "Hello", artist: "Adele" }),
    ];

    const ranked = rankTracks(tracks, "Hello");
    expect(ranked[0].provider).toBe("youtube");
  });

  it("ranks by query match quality", () => {
    const tracks = [
      track({ id: "1", provider: "youtube", title: "World Hello Song", artist: "Band" }),
      track({ id: "2", provider: "youtube", title: "Hello", artist: "Adele" }),
    ];

    const ranked = rankTracks(tracks, "Hello");
    expect(ranked[0].id).toBe("2");
  });
});

describe("normalizeSearchResults edge cases", () => {
  it("returns original results if nothing to normalize", () => {
    const results: SearchResults[] = [
      {
        provider: "deezer",
        tracks: [
          track({ id: "1", provider: "deezer", title: "Unique Song", artist: "Unique Artist" }),
        ],
        albums: [],
        artists: [],
      },
    ];

    const out = normalizeSearchResults(results, "Unique Song");
    expect(out).toHaveLength(1);
    expect(out[0].tracks).toHaveLength(1);
  });

  it("handles empty results", () => {
    const out = normalizeSearchResults([], "test");
    expect(out).toHaveLength(0);
  });

  it("handles tracks without artist", () => {
    const results: SearchResults[] = [
      {
        provider: "youtube",
        tracks: [
          track({ id: "1", provider: "youtube", title: "Mystery Track" }),
          track({ id: "2", provider: "soundcloud", title: "Mystery Track (Remix)" }),
        ],
        albums: [],
        artists: [],
      },
    ];

    const out = normalizeSearchResults(results, "Mystery Track");
    expect(out[0].tracks).toHaveLength(1);
  });
});
