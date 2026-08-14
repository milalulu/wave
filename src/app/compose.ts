import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { SqliteStorage } from "./SqliteStorage";
import type { Storage } from "../core/database/Storage";
import { HistoryService } from "../core/library/HistoryService";
import { LibraryService } from "../core/library/LibraryService";
import { WaveEngine, SmartWaveSource } from "../core/library/WaveEngine";
import { PlayerEngine } from "../core/player/PlayerEngine";
import { WebAudioAdapter } from "../core/player/WebAudioAdapter";
import { offlineEnabled, localUriFor } from "./offline";
import { LyricsService } from "../core/lyrics/LyricsService";
import { LastFmScrobbler } from "../core/lastfm/LastFmScrobbler";
import { iTunesProvider } from "../core/providers/iTunesProvider";
import { YouTubeMusicProvider, type YtDlpGateway } from "../core/providers/YouTubeMusicProvider";
import { SoundCloudProvider } from "../core/providers/SoundCloudProvider";
import { DeezerProvider } from "../core/providers/DeezerProvider";
import { LastFmProvider } from "../core/providers/LastFmProvider";
import { MusicBrainzProvider } from "../core/providers/MusicBrainzProvider";
import { SpotifyProvider } from "../core/providers/SpotifyProvider";
import { VkProvider, type VkGateway } from "../core/providers/VkProvider";
import type { HttpJsonGateway } from "../core/providers/HttpGateway";
import type { LocalSource } from "../core/providers/LocalProvider";
import { LocalProvider } from "../core/providers/LocalProvider";
import type { MusicProvider } from "../core/providers/MusicProvider";
import type { SearchResults, Track } from "../core/types";
import { activeProviders } from "./platformSettings";
import { isArtistBlocked, isTrackBlocked } from "./platformSettings";
import { loadYtQuality } from "./ytQuality";
import { loadCrossfadeMs } from "./crossfade";

interface AppConfig {
  ytdlpPath?: string | null;
  soundcloudClientId?: string | null;
  spotifyClientId?: string | null;
  spotifyClientSecret?: string | null;
  vkToken?: string | null;
  lastfmApiKey?: string | null;
  lastfmApiSecret?: string | null;
  lastfmSessionKey?: string | null;
  lastfmScrobbleEnabled?: boolean;
}

const IS_ANDROID = typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);

const localSource: LocalSource = {
  pickDirectory: async () => {
    const result = await open({ directory: true, multiple: false });
    return typeof result === "string" ? result : null;
  },
  listMusicFiles: async (dir) => invoke("list_music_files", { dir }),
  toUri: (path) =>
    `asset://localhost/${path
      .split("/")
      .filter((s) => s.length > 0)
      .map(encodeURIComponent)
      .join("/")}`,
  pickAudioFiles: IS_ANDROID ? async () => invoke<string[]>("pick_local_audio") : undefined,
};

const ytGateway: YtDlpGateway = {
  search: (query, limit) => invoke("yt_search", { query, limit }),
  stream: (id, quality) => invoke("yt_stream", { id, quality }),
};

const httpGateway: HttpJsonGateway = {
  json: (method, url, body, headers) =>
    invoke("http_fetch_json", {
      method,
      url,
      body: body ?? null,
      headers: Object.entries(headers ?? {}),
    }),
  text: (method, url, body, headers) =>
    invoke("http_fetch_text", {
      method,
      url,
      body: body ?? null,
      headers: Object.entries(headers ?? {}),
    }),
};

const vkGateway: VkGateway = {
  search: (query, count) => invoke("vk_search", { query, count }),
};

export interface AppServices {
  engine: PlayerEngine;
  providers: MusicProvider[];
  local: LocalProvider;
  storage: Storage;
  library: LibraryService;
  history: HistoryService;
  wave: WaveEngine;
  lyrics: LyricsService;
  scrobbler: LastFmScrobbler | null;
}

function buildProviders(cfg: AppConfig): { providers: MusicProvider[]; local: LocalProvider } {
  const providers: MusicProvider[] = [];
  const itunes = new iTunesProvider(httpGateway);
  const deezer = new DeezerProvider(httpGateway);
  const musicbrainz = new MusicBrainzProvider(httpGateway);
  const local = new LocalProvider(localSource);
  providers.push(itunes, deezer, musicbrainz, local);
  if (!IS_ANDROID) {
    const youtube = new YouTubeMusicProvider(ytGateway);
    providers.push(youtube);
  }
  if (cfg.soundcloudClientId) {
    providers.push(new SoundCloudProvider(httpGateway, cfg.soundcloudClientId));
  }
  if (cfg.lastfmApiKey) {
    providers.push(new LastFmProvider(httpGateway, cfg.lastfmApiKey));
  }
  if (cfg.spotifyClientId && cfg.spotifyClientSecret) {
    providers.push(
      new SpotifyProvider(httpGateway, {
        clientId: cfg.spotifyClientId,
        clientSecret: cfg.spotifyClientSecret,
        ytFallback: IS_ANDROID
          ? undefined
          : async (artist, title) => {
              const results = await ytGateway.search(`${artist} ${title}`.trim(), 1);
              const first = results[0];
              if (!first) throw new Error("spotify: no youtube fallback");
              return ytGateway.stream(first.id, loadYtQuality());
            },
      }),
    );
  }
  if (cfg.vkToken) {
    providers.push(new VkProvider(vkGateway));
  }
  return { providers: activeProviders(providers), local };
}

export async function composeServices(): Promise<AppServices> {
  const cfg = await invoke<AppConfig>("app_config");
  const { providers, local } = buildProviders(cfg);

  let wave: WaveEngine;
  const engine: PlayerEngine = new PlayerEngine(new WebAudioAdapter(loadCrossfadeMs()), {
    resolveUri: async (track) => {
      if (offlineEnabled()) {
        const local = localUriFor(track);
        if (local) return local;
      }
      const provider = providers.find((p) => p.id === track.provider);
      return provider ? provider.resolveUri(track) : track.uri;
    },
    onQueueEnd: async () => {
      if (!wave) return [];
      try {
        const waveTracks = await wave.generateWave(10);
        if (waveTracks.length > 0) return waveTracks;
      } catch {
        // ignore
      }
      // Волна пуста (мало лайков/истории) — автопродолжение похожими треками
      // последнего сыгранного трека из внешних источников.
      const last = engine.snapshot.current;
      if (!last) return [];
      try {
        return await radioTracks(
          { engine, providers, local, storage, library, history, wave, lyrics, scrobbler },
          last,
        );
      } catch {
        return [];
      }
    },
  });

  const storage = new SqliteStorage();
  const library = new LibraryService(storage);
  const history = new HistoryService(storage);
  wave = new WaveEngine(storage, providers, new SmartWaveSource());
  const lyrics = new LyricsService(httpGateway);
  const scrobbler = cfg.lastfmScrobbleEnabled ? new LastFmScrobbler(engine) : null;
  engine.on("track", (track) => {
    if (track) void history.recordPlay(track);
  });
  return { engine, providers, local, storage, library, history, wave, lyrics, scrobbler };
}

/**
 * Применить сохранённый конфиг без перезапуска: провайдеры пересобираются
 * in-place (движок и волна держат ссылку на тот же массив), скробблер/лирикс
 * обновляются на лету. Возвращает новый wrapper-объект для перерисовки.
 */
export async function reconfigureServices(services: AppServices): Promise<AppServices> {
  const cfg = await invoke<AppConfig>("app_config");
  const { providers: next, local: nextLocal } = buildProviders(cfg);
  services.providers.length = 0;
  services.providers.push(...next);
  services.local = nextLocal;

  if (cfg.lastfmScrobbleEnabled && !services.scrobbler) {
    services.scrobbler = new LastFmScrobbler(services.engine);
  } else if (!cfg.lastfmScrobbleEnabled && services.scrobbler) {
    services.scrobbler.stop();
    services.scrobbler = null;
  }

  return { ...services };
}

export async function searchAll(
  providers: MusicProvider[],
  query: string,
): Promise<SearchResults[]> {
  const results = await Promise.allSettled(providers.map((p) => p.search(query)));
  return results
    .filter((r): r is PromiseFulfilledResult<SearchResults> => r.status === "fulfilled")
    .map((r) => r.value);
}

/** Подобрать похожие playable-треки для радио/очереди (Last.fm + iTunes превью). */
export async function radioTracks(services: AppServices, seed: Track): Promise<Track[]> {
  const similar = await Promise.allSettled(
    services.providers
      .filter((p) => typeof p.getSimilarTracks === "function")
      .map((p) => p.getSimilarTracks?.(seed.artist ?? "", seed.title ?? "") ?? Promise.resolve([])),
  );
  let candidates = similar.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  // Если похожих треков мало — докидываем топ-треки артиста.
  if (candidates.length < 6 && seed.artist) {
    const top = await Promise.allSettled(
      services.providers
        .filter((p) => typeof p.getArtistTopTracks === "function")
        .map((p) => p.getArtistTopTracks?.(seed.artist ?? "") ?? Promise.resolve([])),
    );
    const extra = top.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
    if (extra.length > 0) candidates = [...candidates, ...extra];
  }
  const itunes = services.providers.find((p) => p.id === "itunes");
  const resolved = await Promise.allSettled(
    candidates.map(async (c) => {
      if (c.meta?.noPlay !== true && c.uri) return c;
      if (!itunes) return null;
      try {
        const res = await itunes.search(`${c.artist ?? ""} ${c.title}`.trim());
        return res.tracks[0] ?? null;
      } catch {
        return null;
      }
    }),
  );
  const seen = new Set<string>([seed.id]);
  const out: Track[] = [];
  for (const r of resolved) {
    if (r.status !== "fulfilled" || !r.value) continue;
    const track = r.value;
    if (seen.has(track.id)) continue;
    if (isTrackBlocked(track.id) || isArtistBlocked(track.artist)) continue;
    seen.add(track.id);
    out.push(track);
    if (out.length >= 12) break;
  }
  return out;
}
