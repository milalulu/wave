import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { searchAll, type AppServices } from "./compose";
import type { Track } from "../core/types";
import { useApp } from "./stores";

function trackJson(track: Track | null): Record<string, unknown> | null {
  if (!track) return null;
  return {
    id: track.id,
    provider: track.provider,
    uri: track.uri,
    title: track.title,
    artist: track.artist,
    album: track.album,
    albumArtist: track.albumArtist,
    coverUrl: track.coverUrl,
    duration: track.duration,
    genre: track.genre,
    year: track.year,
  };
}

export function bindPlugins(services: AppServices): () => void {
  const engine = services.engine;
  const cleanups: Array<() => void> = [];

  let lastStatePush = 0;
  const pushState = (force = false): void => {
    const now = Date.now();
    if (!force && now - lastStatePush < 500) return;
    lastStatePush = now;
    const s = engine.snapshot;
    void invoke("plugin_state", {
      value: {
        state: s.state,
        position: s.position,
        duration: s.duration,
        volume: s.volume,
        shuffle: s.shuffle,
        repeat: s.repeat,
        current: trackJson(s.current),
        queueLength: s.queue.length,
        queueIndex: s.queueIndex,
      },
    }).catch(() => {});
  };

  const ev = (name: string, value?: unknown): void => {
    void invoke("plugin_event", { name, value: value ?? null }).catch(() => {});
  };

  engine.on("state", (state) => {
    pushState(true);
    ev(state === "playing" ? "play" : "pause", { state });
  });
  engine.on("track", (track) => {
    pushState();
    ev("track", { track: trackJson(track) });
  });
  engine.on("time", () => pushState());
  engine.on("volume", (volume) => {
    pushState();
    ev("volume", { volume });
  });
  engine.on("shuffle", (shuffle) => {
    pushState();
    ev("shuffle", { shuffle });
  });
  engine.on("repeat", (repeat) => {
    pushState();
    ev("repeat", { repeat });
  });
  engine.on("queue", () => {
    pushState();
    ev("queue", {
      queueLength: engine.snapshot.queue.length,
      queueIndex: engine.snapshot.queueIndex,
    });
  });
  engine.on("ended", () => ev("ended"));
  engine.on("skipped", (payload) => ev("skip", { position: payload.position, duration: payload.duration }));

  const handleControl = (payload: { method: string; args?: unknown[] }): void => {
    const a = Array.isArray(payload?.args) ? payload.args : [];
    const num = (i: number): number => (typeof a[i] === "number" ? (a[i] as number) : 0);
    switch (payload.method) {
      case "play":
        void engine.play();
        break;
      case "pause":
      case "stop":
        engine.pause();
        break;
      case "toggle":
        void engine.togglePlay();
        break;
      case "next":
        void engine.next();
        break;
      case "prev":
        void engine.previous();
        break;
      case "seek":
        engine.seek(Math.max(0, num(0)));
        break;
      case "jump":
        engine.seek(Math.max(0, engine.snapshot.position + num(0)));
        break;
      case "set_volume":
        engine.setVolume(Math.max(0, Math.min(1, num(0))));
        break;
      case "set_shuffle":
        engine.setShuffle(a[0] === true);
        break;
      case "set_repeat": {
        const mode = a[0];
        engine.setRepeat(mode === "one" || mode === "all" ? mode : "off");
        break;
      }
      default:
        break;
    }
  };

  for (const [name, handler] of [
    ["wave-plugin-control", handleControl],
  ] as const) {
    void listen<{ method: string; args?: unknown[] }>(name, (event) =>
      handler(event.payload),
    ).then((u) => cleanups.push(u));
  }

  void listen<{ reqId: number; query: string; provider?: string | null }>(
    "wave-plugin-search",
    (event) => {
      const { reqId, query, provider } = event.payload;
      const providers = provider
        ? services.providers.filter((p) => p.id === provider)
        : services.providers;
      void (async () => {
        let value: unknown;
        try {
          if (providers.length === 0) {
            value = { query, error: `unknown provider: ${provider ?? ""}` };
          } else {
            const raw = await searchAll(providers, query);
            value = {
              query,
              results: raw.map((r) => ({
                provider: r.provider,
                tracks: (r.tracks ?? []).map((t: Track) => trackJson(t)),
                albums: r.albums ?? [],
                artists: r.artists ?? [],
              })),
            };
          }
        } catch (e) {
          value = { query, error: e instanceof Error ? e.message : String(e) };
        }
        void invoke("plugin_search_result", { reqId, value }).catch(() => {});
      })();
    },
  ).then((u) => cleanups.push(u));

  void listen<{ title: string; body: string }>("wave-plugin-notify", (event) => {
    const { title, body } = event.payload;
    const text = title && body ? `${title}: ${body}` : title || body;
    if (text) useApp.getState().notify(text);
  }).then((u) => cleanups.push(u));

  pushState(true);

  return () => {
    cleanups.forEach((u) => u());
    cleanups.length = 0;
  };
}