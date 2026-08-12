import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { SqliteStorage } from "./SqliteStorage";
import type { Storage } from "../core/database/Storage";
import { HistoryService } from "../core/library/HistoryService";
import { LibraryService } from "../core/library/LibraryService";
import { WaveEngine, WeightedRandomWaveSource } from "../core/library/WaveEngine";
import { PlayerEngine } from "../core/player/PlayerEngine";
import { WebAudioAdapter } from "../core/player/WebAudioAdapter";
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
import { GeniusProvider } from "../core/providers/GeniusProvider";
import type { HttpJsonGateway } from "../core/providers/HttpGateway";
import type { LocalSource } from "../core/providers/LocalProvider";
import { LocalProvider } from "../core/providers/LocalProvider";
import type { MusicProvider } from "../core/providers/MusicProvider";
import type { SearchResults } from "../core/types";

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
  geniusToken?: string | null;
}

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
};

const ytGateway: YtDlpGateway = {
  search: (query, limit) => invoke("yt_search", { query, limit }),
  stream: (id) => invoke("yt_stream", { id }),
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

export async function composeServices(): Promise<AppServices> {
  const cfg = await invoke<AppConfig>("app_config");
  const providers: MusicProvider[] = [];

  let wave: WaveEngine;
  const engine = new PlayerEngine(new WebAudioAdapter(), {
    resolveUri: async (track) => {
      const provider = providers.find((p) => p.id === track.provider);
      return provider ? provider.resolveUri(track) : track.uri;
    },
    onQueueEnd: async () => {
      if (!wave) return [];
      try {
        return await wave.generateWave(10);
      } catch {
        return [];
      }
    },
  });

  const storage = new SqliteStorage();
  const itunes = new iTunesProvider();
  const youtube = new YouTubeMusicProvider(ytGateway);
  const deezer = new DeezerProvider(httpGateway);
  const musicbrainz = new MusicBrainzProvider(httpGateway);
  const local = new LocalProvider(localSource);
  providers.push(itunes, youtube, deezer, musicbrainz, local);
  if (cfg.soundcloudClientId) {
    providers.push(new SoundCloudProvider(httpGateway, cfg.soundcloudClientId));
  }
  if (cfg.lastfmApiKey) {
    providers.push(new LastFmProvider(httpGateway, cfg.lastfmApiKey));
  }
  if (cfg.geniusToken) {
    providers.push(new GeniusProvider(httpGateway, cfg.geniusToken));
  }
  if (cfg.spotifyClientId && cfg.spotifyClientSecret) {
    providers.push(new SpotifyProvider(httpGateway, {
      clientId: cfg.spotifyClientId,
      clientSecret: cfg.spotifyClientSecret,
    }));
  }
  if (cfg.vkToken) {
    providers.push(new VkProvider(vkGateway));
  }

  const library = new LibraryService(storage);
  const history = new HistoryService(storage);
  wave = new WaveEngine(storage, providers, new WeightedRandomWaveSource());
  const lyrics = new LyricsService(httpGateway, cfg.geniusToken ?? undefined);
  const scrobbler = cfg.lastfmScrobbleEnabled ? new LastFmScrobbler(engine) : null;
  engine.on("track", (track) => {
    if (track) void history.recordPlay(track);
  });
  return { engine, providers, local, storage, library, history, wave, lyrics, scrobbler };
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
