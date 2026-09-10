import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string) => {
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
    throw new Error(`unexpected invoke: ${cmd}`);
  }),
  convertFileSrc: (p: string) => p,
}));

import type { HttpJsonGateway } from "../providers/HttpGateway";
import { SpotifyProvider } from "../providers/SpotifyProvider";
import { YouTubeMusicProvider } from "../providers/YouTubeMusicProvider";
import { SoundCloudProvider } from "../providers/SoundCloudProvider";
import { detectPlaylistLink, importPlaylistLink } from "./playlistLink";
import type { AppServices } from "../../app/compose";

function routeHttp(routes: Record<string, (url: string) => unknown>): HttpJsonGateway {
  return {
    json: async (_method: string, url: string) => {
      for (const [prefix, handler] of Object.entries(routes)) {
        if (url.includes(prefix)) return { status: 200, body: handler(url) };
      }
      throw new Error(`no route for ${url}`);
    },
    text: async () => {
      throw new Error("no text");
    },
  };
}

const spotifyHttp = () =>
  routeHttp({
    "/api/token": () => ({ access_token: "tok" }),
    "/v1/tracks/": () => ({
      id: "t1",
      name: "Spot Song",
      artists: [{ name: "Spot Artist" }],
      album: { name: "Spot Album" },
      duration_ms: 180000,
    }),
    "/v1/playlists/": () => ({
      name: "Spot List",
      tracks: {
        items: [
          {
            track: {
              id: "t2",
              name: "List Song",
              artists: [{ name: "List Artist" }],
              album: { name: "A" },
              duration_ms: 200000,
            },
          },
          { track: null },
        ],
      },
    }),
  });

function services(): AppServices {
  return {
    providers: [
      new SpotifyProvider(spotifyHttp(), { clientId: "c", clientSecret: "s" }),
      new YouTubeMusicProvider({ search: async () => [], stream: async () => "" }),
      new SoundCloudProvider({ search: async () => [], stream: async () => "" }),
    ],
  } as unknown as AppServices;
}

describe("detectPlaylistLink", () => {
  it("распознаёт Spotify трек/альбом/плейлист", () => {
    expect(detectPlaylistLink("https://open.spotify.com/track/abc123?si=x")).toEqual({
      kind: "spotify",
      sub: "track",
      id: "abc123",
    });
    expect(detectPlaylistLink("https://open.spotify.com/intl-ru/album/xyz789")).toEqual({
      kind: "spotify",
      sub: "album",
      id: "xyz789",
    });
    expect(detectPlaylistLink("https://open.spotify.com/playlist/pl000")).toEqual({
      kind: "spotify",
      sub: "playlist",
      id: "pl000",
    });
  });

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
  });

  it("распознаёт SoundCloud и отбрасывает мусор", () => {
    expect(detectPlaylistLink("https://soundcloud.com/artist/track-name")).toEqual({
      kind: "soundcloud",
      url: "https://soundcloud.com/artist/track-name",
    });
    expect(detectPlaylistLink("not a url")).toBeNull();
    expect(detectPlaylistLink("https://example.com/foo")).toBeNull();
  });
});

describe("importPlaylistLink", () => {
  it("импортирует Spotify-трек", async () => {
    const out = await importPlaylistLink(services(), "https://open.spotify.com/track/t1");
    expect(out.tracks).toHaveLength(1);
    expect(out.tracks[0]).toMatchObject({ provider: "spotify", title: "Spot Song" });
  });

  it("импортирует Spotify-плейлист без пустых слотов", async () => {
    const out = await importPlaylistLink(services(), "https://open.spotify.com/playlist/pl1");
    expect(out.name).toBe("Spot List");
    expect(out.tracks.map((t) => t.title)).toEqual(["List Song"]);
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

  it("бросает понятные ошибки", async () => {
    await expect(importPlaylistLink(services(), "garbage")).rejects.toThrow("unsupported link");
    await expect(
      importPlaylistLink(services(), "https://music.youtube.com/watch?v=x&list=PL1"),
    ).rejects.toThrow("not supported");
  });
});
