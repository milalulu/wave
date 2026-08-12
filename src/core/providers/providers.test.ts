import { describe, expect, it } from "vitest";
import type { HttpJsonGateway } from "./HttpGateway";
import type { YtDlpGateway } from "./YouTubeMusicProvider";
import type { VkGateway } from "./VkProvider";
import { DeezerProvider } from "./DeezerProvider";
import { SoundCloudProvider } from "./SoundCloudProvider";
import { YouTubeMusicProvider } from "./YouTubeMusicProvider";
import { VkProvider } from "./VkProvider";
import { LastFmProvider } from "./LastFmProvider";
import { MusicBrainzProvider } from "./MusicBrainzProvider";

function routeHttp(routes: Record<string, (url: string) => unknown>): HttpJsonGateway {
  return {
    json: async (_method: string, url: string) => {
      for (const [prefix, handler] of Object.entries(routes)) {
        if (url.includes(prefix)) {
          return { status: 200, body: handler(url) };
        }
      }
      throw new Error(`no route for ${url}`);
    },
    text: async (_method: string, url: string) => {
      throw new Error(`no text route for ${url}`);
    },
  };
}

describe("DeezerProvider", () => {
  it("мапит треки с превью и отбрасывает без превью", async () => {
    const http = routeHttp({
      "/search?q=": () => ({
        data: [
          {
            id: 1,
            title: "A",
            artist: { name: "X" },
            album: { title: "Al", cover_medium: "c.jpg" },
            duration: 180,
            preview: "https://preview.mp3",
          },
          { id: 2, title: "B", artist: { name: "Y" }, album: { title: "Al2" }, duration: 90 },
        ],
      }),
      "/search/album": () => ({ data: [] }),
      "/search/artist": () => ({ data: [] }),
    });
    const r = await new DeezerProvider(http).search("test");
    expect(r.tracks).toHaveLength(1);
    expect(r.tracks[0]).toMatchObject({ uri: "https://preview.mp3", provider: "deezer" });
  });
});

describe("SoundCloudProvider", () => {
  it("ищет треки и разрешает progressive mp3", async () => {
    const http = routeHttp({
      "/search/tracks?q=": () => ({
        collection: [
          {
            id: 42,
            title: "SC Track",
            user: { username: "SC Artist" },
            artwork_url: "https://i.sndcdn.com/a-large.jpg",
            duration: 200000,
            access: { token: "tk" },
          },
        ],
      }),
      "/tracks/42?": () => ({
        media: {
          transcodings: [
            { format: { protocol: "progressive", mime_type: "audio/mpeg" }, url: "https://stream" },
            { format: { protocol: "hls", mime_type: "audio/mpegurl" }, url: "https://hls" },
          ],
        },
      }),
      "/stream?": () => ({ url: "https://cf-media.sndcdn.com/x.mp3" }),
    });
    const p = new SoundCloudProvider(http, "cid");
    const r = await p.search("test");
    expect(r.tracks[0]).toMatchObject({
      title: "SC Track",
      artist: "SC Artist",
      coverUrl: "https://i.sndcdn.com/a-t500x500.jpg",
    });
    expect(await p.resolveUri(r.tracks[0])).toBe("https://cf-media.sndcdn.com/x.mp3");
  });
});

describe("YouTubeMusicProvider", () => {
  it("мапит результаты поиска и резолвит поток по ytId", async () => {
    const gateway: YtDlpGateway = {
      search: async () => [
        { id: "abc123", title: "YT Track", uploader: "Channel", duration: 250, thumbnail: "t.jpg" },
      ],
      stream: async (id: string) => `https://stream/${id}`,
    };
    const p = new YouTubeMusicProvider(gateway);
    const r = await p.search("test");
    expect(r.tracks[0]).toMatchObject({
      provider: "youtube",
      title: "YT Track",
      meta: { ytId: "abc123" },
    });
    expect(await p.resolveUri(r.tracks[0])).toBe("https://stream/abc123");
  });
});

describe("VkProvider", () => {
  it("извлекает треки из вложенного ответа al_audio", async () => {
    const gateway: VkGateway = {
      search: async () => [
        "1",
        [
          [
            0,
            "search",
            [
              [123, -1, "https://cs1-9000.mp3", "VK Track", 213, "VK Artist"],
              [124, -2, "https://cs1-9001.mp3", "Another", 100, "Other"],
              ["not", "an", "audio"],
            ],
          ],
        ],
      ],
    };
    const r = await new VkProvider(gateway).search("test");
    expect(r.tracks).toHaveLength(2);
    expect(r.tracks[0]).toMatchObject({ id: "vk:track:-1_123", title: "VK Track", artist: "VK Artist", duration: 213 });
  });
});

describe("LastFmProvider", () => {
  it("возвращает треки с noPlay и обложками", async () => {
    const http = routeHttp({
      "/?method=track.search": () => ({
        results: {
          trackmatches: {
            track: [{ name: "LF Track", artist: "LF Artist", image: [{ size: "extralarge", "#text": "lf.jpg" }] }],
          },
        },
      }),
      "/?method=album.search": () => ({ results: { albummatches: { album: [] } } }),
      "/?method=artist.search": () => ({ results: { artistmatches: { artist: [] } } }),
    });
    const r = await new LastFmProvider(http, "key").search("test");
    expect(r.tracks[0]).toMatchObject({ provider: "lastfm", coverUrl: "lf.jpg", meta: { noPlay: true } });
  });
});

describe("MusicBrainzProvider", () => {
  it("парсит записи с артистом и длительностью", async () => {
    const http = routeHttp({
      "/recording?query=": () => ({
        recordings: [
          { id: "mbid1", title: "MB Track", artist_credit: [{ name: "MB Artist" }], length: 180000 },
        ],
      }),
    });
    const r = await new MusicBrainzProvider(http).search("test");
    expect(r.tracks[0]).toMatchObject({
      provider: "musicbrainz",
      duration: 180,
      meta: { noPlay: true },
    });
  });
});