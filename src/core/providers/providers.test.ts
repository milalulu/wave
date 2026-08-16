import { describe, expect, it } from "vitest";
import type { HttpJsonGateway } from "./HttpGateway";
import type { YtDlpGateway } from "./YouTubeMusicProvider";
import type { VkGateway } from "./VkProvider";
import { DeezerProvider } from "./DeezerProvider";
import { iTunesProvider } from "./iTunesProvider";
import { SoundCloudProvider, type SoundCloudDlpGateway } from "./SoundCloudProvider";
import { YouTubeMusicProvider } from "./YouTubeMusicProvider";
import { VkProvider } from "./VkProvider";
import { LastFmProvider } from "./LastFmProvider";
import { MusicBrainzProvider } from "./MusicBrainzProvider";
import { SpotifyProvider } from "./SpotifyProvider";

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

  it("пере-резолвит свежее превью и кэширует его в пределах TTL", async () => {
    let hits = 0;
    const http = routeHttp({
      "/track/1": () => {
        hits += 1;
        return { preview: `https://fresh-preview.mp3?exp=${hits}` };
      },
    });
    const p = new DeezerProvider(http);
    const track = { id: "deezer:track:1", provider: "deezer", title: "A", uri: "https://old.mp3" } as const;
    const first = await p.resolveUri(track as never);
    const second = await p.resolveUri(track as never);
    expect(first).toBe("https://fresh-preview.mp3?exp=1");
    expect(second).toBe(first);
    expect(hits).toBe(1);
  });

  it("откатывается на старый URL, если свежий не получить", async () => {
    const http: HttpJsonGateway = {
      json: async () => {
        throw new Error("network down");
      },
      text: async () => {
        throw new Error("no text route");
      },
    };
    const p = new DeezerProvider(http);
    const track = { id: "deezer:track:1", provider: "deezer", title: "A", uri: "https://old.mp3" } as const;
    expect(await p.resolveUri(track as never)).toBe("https://old.mp3");
  });
});

describe("iTunesProvider", () => {
  it("пере-резолвит свежее превью через lookup", async () => {
    const http = routeHttp({
      "/lookup?id=7&entity=track": () => ({
        results: [
          { wrapperType: "track", trackId: 7, previewUrl: "https://fresh-itunes-preview.m4a" },
          { wrapperType: "track", trackId: 7, previewUrl: "https://fresh-itunes-preview.m4a" },
        ],
      }),
    });
    const p = new iTunesProvider(http);
    const track = { id: "itunes:track:7", provider: "itunes", title: "A", uri: "https://old.m4a" } as const;
    expect(await p.resolveUri(track as never)).toBe("https://fresh-itunes-preview.m4a");
  });

  it("откатывается на старый URL при ошибке lookup", async () => {
    const http = routeHttp({});
    const p = new iTunesProvider(http);
    const track = { id: "itunes:track:7", provider: "itunes", title: "A", uri: "https://old.m4a" } as const;
    expect(await p.resolveUri(track as never)).toBe("https://old.m4a");
  });
});

describe("SoundCloudProvider", () => {
  it("ищет треки через scsearch и резолвит mp3-стрим", async () => {
    const gateway: SoundCloudDlpGateway = {
      search: async () => [
        {
          id: "42",
          title: "SC Track",
          uploader: "SC Artist",
          duration: 200,
          thumbnail: "https://i.sndcdn.com/a-mini.jpg",
        },
      ],
      stream: async () => "https://cf-media.sndcdn.com/x.mp3",
    };
    const p = new SoundCloudProvider(gateway);
    const r = await p.search("test");
    expect(r.tracks[0]).toMatchObject({
      provider: "soundcloud",
      title: "SC Track",
      artist: "SC Artist",
      coverUrl: "https://i.sndcdn.com/a-t500x500.jpg",
      meta: { scId: "42", scUrl: "https://api.soundcloud.com/tracks/soundcloud%3Atracks%3A42" },
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

  it("передаёт выбранное качество и кэширует поток-URL", async () => {
    const calls: Array<{ id: string; quality?: string }> = [];
    const gateway: YtDlpGateway = {
      search: async () => [],
      stream: async (id: string, quality?: string) => {
        calls.push({ id, quality });
        return `https://stream/${id}?q=${quality ?? "best"}`;
      },
    };
    const p = new YouTubeMusicProvider(gateway);
    const track = {
      id: "youtube:track:vid1",
      provider: "youtube",
      title: "T",
      meta: { ytId: "vid1" },
    } as const;
    const first = await p.resolveUri(track as never);
    const second = await p.resolveUri(track as never);
    expect(first).toBe("https://stream/vid1?q=best");
    expect(second).toBe(first);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ id: "vid1", quality: "best" });
  });

  it("кэширует результаты поиска в пределах TTL", async () => {
    let hits = 0;
    const gateway: YtDlpGateway = {
      search: async () => {
        hits += 1;
        return [{ id: "x", title: "X" }];
      },
      stream: async (id: string) => `https://stream/${id}`,
    };
    const p = new YouTubeMusicProvider(gateway);
    await p.search("q1");
    await p.search("q1");
    expect(hits).toBe(1);
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

describe("SpotifyProvider", () => {
  const spotifyHttp = (routes: Record<string, (url: string) => unknown>): HttpJsonGateway =>
    routeHttp({
      "/api/token": () => ({ access_token: "tok" }),
      ...routes,
    });

  const searchBody = (preview?: string) => ({
    tracks: {
      items: [
        {
          id: "1",
          name: "Spotify Track",
          artists: [{ name: "Spotify Artist" }],
          album: { name: "Album" },
          duration_ms: 200000,
          preview_url: preview,
        },
      ],
    },
    albums: { items: [] },
    artists: { items: [] },
  });

  it("не метит треки превью, когда настроен YouTube-fallback", async () => {
    const http = spotifyHttp({
      "/v1/search?q=": () => searchBody("https://p.scdn.co/1.mp3"),
    });
    const p = new SpotifyProvider(http, {
      clientId: "c",
      clientSecret: "s",
      ytFallback: async () => "https://yt/stream",
    });
    const r = await p.search("test");
    expect(r.tracks[0].meta?.preview).toBeUndefined();
  });

  it("метит треки превью без YouTube-fallback", async () => {
    const http = spotifyHttp({
      "/v1/search?q=": () => searchBody("https://p.scdn.co/1.mp3"),
    });
    const p = new SpotifyProvider(http, { clientId: "c", clientSecret: "s" });
    const r = await p.search("test");
    expect(r.tracks[0].meta?.preview).toBe(true);
  });

  it("resolveUri предпочитает полную версию через ytFallback", async () => {
    const http = spotifyHttp({});
    const p = new SpotifyProvider(http, {
      clientId: "c",
      clientSecret: "s",
      ytFallback: async () => "https://yt/full",
    });
    const track = {
      id: "spotify:track:1",
      provider: "spotify",
      uri: "https://p.scdn.co/1.mp3",
      title: "T",
      artist: "A",
    } as const;
    expect(await p.resolveUri(track as never)).toBe("https://yt/full");
  });

  it("resolveUri падает на превью, если ytFallback упал", async () => {
    const http = spotifyHttp({});
    const p = new SpotifyProvider(http, {
      clientId: "c",
      clientSecret: "s",
      ytFallback: async () => {
        throw new Error("no youtube match");
      },
    });
    const track = {
      id: "spotify:track:1",
      provider: "spotify",
      uri: "https://p.scdn.co/1.mp3",
      title: "T",
      artist: "A",
    } as const;
    expect(await p.resolveUri(track as never)).toBe("https://p.scdn.co/1.mp3");
  });

  it("resolveUri кэширует результат ytFallback", async () => {
    let calls = 0;
    const http = spotifyHttp({});
    const p = new SpotifyProvider(http, {
      clientId: "c",
      clientSecret: "s",
      ytFallback: async () => {
        calls += 1;
        return `https://yt/full-${calls}`;
      },
    });
    const track = { id: "spotify:track:1", provider: "spotify", title: "T", artist: "A" } as const;
    expect(await p.resolveUri(track as never)).toBe("https://yt/full-1");
    expect(await p.resolveUri(track as never)).toBe("https://yt/full-1");
    expect(calls).toBe(1);
  });

  it("resolveUri бросает ошибку без источника и без fallback", async () => {
    const http = spotifyHttp({});
    const p = new SpotifyProvider(http, { clientId: "c", clientSecret: "s" });
    const track = { id: "spotify:track:1", provider: "spotify", title: "T", artist: "A" } as const;
    await expect(p.resolveUri(track as never)).rejects.toThrow("no playable source");
  });
});