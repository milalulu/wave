import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string) => {
    if (cmd === "yt_search_innertube_full") {
      return { albums: [], artists: [], tracks: [
        { id: "ABCDEFGHIJK", title: "An upload", uploader: "An artist", channelId: "UC1234567890123456789012" },
      ] };
    }
    if (cmd === "yt_artist_channel") {
      return { title: "An artist - Videos", channel: "An artist", entries: [
        { id: "ABCDEFGHIJK", title: "An upload" },
      ] };
    }
    if (cmd === "yt_import_playlist") {
      return { title: "Example album", entries: [
        { id: "ZYXWVUTSRQP", title: "First track", artist: "Artist", duration: 125 },
        { id: "ABCDEFGHIJK", title: "Second track", artist: null, duration: null },
        { id: "ZYXWVUTSRQP", title: "First track", artist: "Artist", duration: 125 },
      ] };
    }
    if (cmd === "http_fetch_json") {
      return { status: 200, body: { title: "Vid Title", author_name: "Vid Author" } };
    }
    if (cmd === "sc_resolve_url") {
      return {
        kind: "track",
        id: 123,
        title: "SC Song",
        duration: 200000,
        user: { username: "SC Artist" },
        artwork_url: null,
      };
    }
    if (cmd === "sc_import_likes") {
      return { name: "Public account · SoundCloud Likes", tracks: [
        { id: "101", title: "First liked", uploader: "One", duration: 127 },
        { id: "102", title: "Second liked", uploader: "Two", genre: "House", tagList: "\"deep house\" dance" },
      ] };
    }
    throw new Error(`unexpected invoke: ${cmd}`);
  }),
  convertFileSrc: (p: string) => p,
}));

import { YouTubeMusicProvider } from "../providers/YouTubeMusicProvider";
import { SoundCloudProvider } from "../providers/SoundCloudProvider";
import { detectPlaylistLink, importPlaylistLink } from "./playlistLink";
import type { AppServices } from "../../app/compose";

function services(): AppServices {
  return {
    providers: [
      new YouTubeMusicProvider({ search: async () => [], stream: async () => "" }),
      new SoundCloudProvider({ search: async () => [], stream: async () => "" }),
    ],
  } as unknown as AppServices;
}

describe("detectPlaylistLink", () => {
  it("распознаёт YouTube видео и плейлисты", () => {
    expect(detectPlaylistLink("https://www.youtube.com/watch?v=V9PVRfjEBTI")).toEqual({
      kind: "youtube-video",
      id: "V9PVRfjEBTI",
    });
    expect(detectPlaylistLink("https://youtu.be/V9PVRfjEBTI")).toEqual({
      kind: "youtube-video",
      id: "V9PVRfjEBTI",
    });
    expect(detectPlaylistLink("https://music.youtube.com/watch?v=abc&list=PL123")).toEqual({
      kind: "youtube-playlist",
      id: "PL123",
    });
    expect(detectPlaylistLink("https://music.youtube.com/playlist?list=PL123")).toEqual({
      kind: "youtube-playlist", id: "PL123",
    });
    expect(detectPlaylistLink("https://example.com/youtube.com/watch?v=ABCDEFGHIJK&list=PL123")).toBeNull();
  });

  it("распознаёт SoundCloud и отбрасывает мусор", () => {
    expect(detectPlaylistLink("https://soundcloud.com/artist/track-name")).toEqual({
      kind: "soundcloud",
      url: "https://soundcloud.com/artist/track-name",
    });
    expect(detectPlaylistLink("https://open.spotify.com/track/abc123")).toBeNull();
    expect(detectPlaylistLink("https://www.soundcloud.com/public-account/likes/?utm_source=share"))
      .toEqual({ kind: "soundcloud-likes", profile: "public-account" });
    expect(detectPlaylistLink("https://soundcloud.com.somewhere.test/public-account/likes")).toBeNull();
    expect(detectPlaylistLink("https://someone@soundcloud.com/public-account/likes")).toBeNull();
    expect(detectPlaylistLink("not a url")).toBeNull();
    expect(detectPlaylistLink("https://example.com/foo")).toBeNull();
  });
});

describe("importPlaylistLink", () => {
  it("opens YouTube artist details with playable uploads and a channel identity", async () => {
    const provider = services().providers[0];
    const { artists } = await provider.search("An artist");
    expect(artists[0]).toMatchObject({ id: "youtube:artist:UC1234567890123456789012", name: "An artist" });
    const detail = await provider.getArtist(artists[0].id);
    expect(detail.artist).toMatchObject({ name: "An artist", meta: { recentUploads: true } });
    expect(detail.topTracks[0]).toMatchObject({ title: "An upload", artist: "An artist", provider: "youtube" });
  });
  it("imports a YouTube Music playlist in order, preserving intentional repeats", async () => {
    const out = await importPlaylistLink(services(), "https://music.youtube.com/playlist?list=PL123");
    expect(out.name).toBe("Example album");
    expect(out.tracks.map((track) => track.meta?.ytId)).toEqual(["ZYXWVUTSRQP", "ABCDEFGHIJK", "ZYXWVUTSRQP"]);
    expect(out.tracks[1]).toMatchObject({ artist: undefined, duration: undefined });
  });

  it("opens an album result through the same playlist reader", async () => {
    const album = await services().providers[0].getAlbum("youtube:album:PL123");
    expect(album.album).toMatchObject({ id: "youtube:album:PL123", title: "Example album", trackCount: 3 });
  });
  it("импортирует YouTube-видео через oEmbed", async () => {
    const out = await importPlaylistLink(services(), "https://youtu.be/V9PVRfjEBTI");
    expect(out.tracks[0]).toMatchObject({
      provider: "youtube",
      title: "Vid Title",
      artist: "Vid Author",
      uri: "https://www.youtube.com/watch?v=V9PVRfjEBTI",
    });
  });

  it("импортирует SoundCloud-трек через resolve", async () => {
    const out = await importPlaylistLink(services(), "https://soundcloud.com/artist/track-name");
    expect(out.tracks[0]).toMatchObject({
      provider: "soundcloud",
      title: "SC Song",
      duration: 200,
    });
  });

  it("imports a public SoundCloud likes page as a playlist in source order", async () => {
    const out = await importPlaylistLink(services(), "https://soundcloud.com/public-account/likes");
    expect(out.name).toBe("Public account · SoundCloud Likes");
    expect(out.tracks.map((track) => track.id)).toEqual(["soundcloud:track:101", "soundcloud:track:102"]);
    expect(out.tracks[1]).toMatchObject({ genre: "House", meta: { tags: ["deep house", "dance"] } });
  });

  it("бросает понятные ошибки", async () => {
    await expect(importPlaylistLink(services(), "garbage")).rejects.toThrow("Unsupported link");
    await expect(importPlaylistLink({ providers: [] } as unknown as AppServices, "https://music.youtube.com/playlist?list=PL1"))
      .rejects.toThrow("provider unavailable");
  });
});
