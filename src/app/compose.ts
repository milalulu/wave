import { sameRecording, uniqueRecommendations } from "../core/recordings/matching";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { RecordingCatalog } from "../core/recordings/RecordingCatalog";
import { RecordingStorage } from "../core/recordings/RecordingStorage";
import { playbackSource } from "../core/types";
import { pickStorage, type StorageBackend } from "./storage";
import type { Storage } from "../core/database/Storage";
import { HistoryService } from "../core/library/HistoryService";
import { LibraryService } from "../core/library/LibraryService";
import { WaveEngine, SmartWaveSource } from "../core/library/WaveEngine";
import { PlayerEngine } from "../core/player/PlayerEngine";
import { WebAudioAdapter } from "../core/player/WebAudioAdapter";
import { createStreamResolver } from "./streamResolver";
import { OutputRouter } from "../core/player/OutputRouter";
import { StreamPrewarmer } from "../core/player/streamPrewarm";
import { LyricsService } from "../core/lyrics/LyricsService";
import { YouTubeMusicProvider, type YtDlpGateway } from "../core/providers/YouTubeMusicProvider";
import { SoundCloudProvider } from "../core/providers/SoundCloudProvider";
import type { HttpJsonGateway } from "../core/providers/HttpGateway";
import type { LocalSource } from "../core/providers/LocalProvider";
import { LocalProvider } from "../core/providers/LocalProvider";
import type { MusicProvider } from "../core/providers/MusicProvider";
import type { SearchResults, Track } from "../core/types";
import { activeProviders, refreshRemoteProviderFlags } from "./platformSettings";
import { filterPreviewResults, isExcludePreviewsEnabled } from "./platformSettings";
import { isArtistBlocked, isTrackBlocked } from "./platformSettings";
import { loadCrossfadeMs } from "./crossfade";
import { loadDiscoveryRate } from "./discoveryRate";
import { loadHistoryDecayDays } from "./historyDecay";
import { loadAutoGenerateThreshold } from "./autoGenerateThreshold";
import { loadPreferredLanguages } from "./preferredLanguages";
import { loadOnboardingArtists } from "./onboarding";
import { findTrackVariants } from "./trackVariants";
import { streamCache } from "../core/player/streamCache";
import { normalizeSearchResults } from "../core/search/normalizeSearch";
import { withDeadline } from "../core/util/deadline";
import { rankCandidates } from "../core/recommendations/rankCandidates";
import { offlineEnabled } from "./offline";
import { getRecommendationFeedback } from "./recommendationFeedback";
import { cachePlayedAudio } from "./offlineCache";
import { measureLocalLoudness } from "./measureLoudness";
import { verifiedRecordingMatch } from "../core/recordings/matching";

const FULL_PLAYBACK_PROVIDERS = new Set(["youtube", "soundcloud"]);

const IS_ANDROID = typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);

const localSource: LocalSource = {
  pickDirectory: async () => {
    const result = await open({ directory: true, multiple: false });
    return typeof result === "string" ? result : null;
  },
  listMusicFiles: async (dir) => invoke("list_music_files", { dir }),
  toUri: (path) => convertFileSrc(path),
  pickAudioFiles: IS_ANDROID ? async () => invoke<string[]>("pick_local_audio") : undefined,
};

const ytGateway: YtDlpGateway = {
  search: (query, limit) => invoke("yt_search", { query, limit }),
  stream: (id, quality) => invoke("yt_stream_fast", { id, quality }),
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

export interface AppServices {
  engine: PlayerEngine;
  providers: MusicProvider[];
  prewarmer?: StreamPrewarmer;
  output?: OutputRouter;
  local: LocalProvider;
  storage: Storage;
  storageBackend?: StorageBackend;
  recordings?: RecordingCatalog;
  library: LibraryService;
  history: HistoryService;
  wave: WaveEngine;
  lyrics: LyricsService;
}

function buildProviders(): MusicProvider[] {
  const providers: MusicProvider[] = [];
  // YouTube и SoundCloud работают и без yt-dlp (innertube / SoundCloud API),
  // yt-dlp используется только как фолбэк на десктопе.
  providers.push(new YouTubeMusicProvider(ytGateway));

  providers.push(
    new SoundCloudProvider({
      search: (query, limit) => invoke("yt_search", { query, limit, provider: "sc" }),
      stream: async (url) => {
        try {
          return await invoke<string>("dl_stream_fast", { url });
        } catch {
          return invoke<string>("dl_stream", { url });
        }
      },
    }),
  );
  return activeProviders(providers);
}

export async function composeServices(): Promise<AppServices> {
  // Удалённые флаги (kill-switch сломанных провайдеров): ждём не дольше
  // 1.5с, дальше — кеш (fail-open, холодный старт не страдает).
  const loadStorage = async () => {
    const { storage, backend } = await pickStorage();
    const recordings = new RecordingCatalog(storage);
    await recordings.init();
    return { storage, recordings, backend };
  };
  let flagTimeout: ReturnType<typeof setTimeout> | undefined;
  const refreshFlags = Promise.race([
    refreshRemoteProviderFlags(),
    new Promise<void>((resolve) => { flagTimeout = setTimeout(resolve, 1500); }),
  ]).finally(() => clearTimeout(flagTimeout));
  const [{ storage: baseStorage, recordings, backend: storageBackend }] = await Promise.all([loadStorage(), refreshFlags]);
  const providers = buildProviders();
  const local = new LocalProvider(localSource);

  // eslint-disable-next-line prefer-const
  let wave: WaveEngine;
  const storage = new RecordingStorage(baseStorage, recordings);
  const resolveUri = createStreamResolver(providers, async (track) =>
    (await findTrackVariants(providers, track)).map((variant) => variant.track),
  );
  const prewarmer = new StreamPrewarmer((track) => resolveUri(recordings.resolve(track)));
  const output = new OutputRouter(new WebAudioAdapter(loadCrossfadeMs()));
  const engine: PlayerEngine = new PlayerEngine(output, {
    autoGenerateThreshold: loadAutoGenerateThreshold(),
    crossfadeMs: loadCrossfadeMs(),
    measureLoudness: measureLocalLoudness,
    prepareTrack: (track) => recordings.resolve(track),
    resolveUri,
    invalidateStream: (trackId) => {
      streamCache.invalidate(trackId);
      const match = trackId.match(/^([^:]+):/);
      if (!match) return;
      const provider = providers.find((p) => p.id === match[1]);
      provider?.invalidateStream?.(trackId);
    },
    recoverSource: async (track) => {
      if (offlineEnabled()) return null;
      const source = playbackSource(track);
      const stored = recordings.sources(track).find((candidate) =>
        candidate.provider !== source.provider && providers.some((provider) => provider.id === candidate.provider),
      );
      if (stored) return recordings.withSource(track, stored);
      const match = (await findTrackVariants(providers, track)).find((variant) => verifiedRecordingMatch(source, variant.track));
      return match && !offlineEnabled() ? recordings.withSource(track, match.track) : null;
    },
    
    
    upgradePreview: async (track) => {
      try {
        const variants = await findTrackVariants(providers, track);
        const full = variants.find((v) => FULL_PLAYBACK_PROVIDERS.has(v.providerId));
        return full ? recordings.withSource(track, full.track) : null;
      } catch {
        return null;
      }
    },
    onQueueEnd: async () => {
      if (offlineEnabled()) return [];
      const snapshot = engine.snapshot;
      const seed = snapshot.shuffle ? snapshot.current : snapshot.queue[snapshot.queue.length - 1] ?? snapshot.current;
      if (!seed) return [];
      const services = { engine, providers, local, storage, library, history, wave, lyrics };
      const recent = await storage.getHistory(35).catch(() => []);
      const queue = [...snapshot.queue, ...recent.map(({ track }) => track)];
      const related = await radioTracks(services, seed, queue).catch(() => []);
      if (offlineEnabled()) return [];
      if (related.length >= 6 || !wave) return related;
      const extras = await wave.generateWave(12 - related.length, [...queue, ...related], seed).catch(() => []);
      if (offlineEnabled()) return [];
      return uniqueRecommendations([...related, ...extras], engine.snapshot.queue).slice(0, 12);
    },
  });

  const library = new LibraryService(storage);
  const history = new HistoryService(storage);
   wave = new WaveEngine(storage, providers, new SmartWaveSource());
   wave.setHistoryDecayDays(loadHistoryDecayDays());
   wave.setDiscoveryRate(loadDiscoveryRate());
   wave.setPreferredLanguages(loadPreferredLanguages());
   wave.setFeedbackSource(getRecommendationFeedback);
   wave.setOnboardingArtists(loadOnboardingArtists());
  const lyrics = new LyricsService(httpGateway, async (track) =>
    (await findTrackVariants(providers, track)).map((variant) => variant.track),
  );
  engine.on("played", (track) => {
    void history.recordPlay(track).catch((error: unknown) => console.error("History write failed", error));
    if (!offlineEnabled()) void cachePlayedAudio(track, resolveUri).catch(() => {});
  });
  return { engine, providers, prewarmer, output, local, storage, storageBackend, recordings, library, history, wave, lyrics };
}

export async function reconfigureServices(services: AppServices): Promise<AppServices> {
  services.prewarmer?.cancel();
  streamCache.clear();
  const next = buildProviders();
  services.providers.length = 0;
  services.providers.push(...next);
  return { ...services };
}

const SEARCH_PROVIDER_TIMEOUT_MS = 20_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}: timeout`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export async function searchAll(
  providers: MusicProvider[],
  query: string,
  recordings?: RecordingCatalog,
): Promise<SearchResults[]> {
  return (await searchAllDetailed(providers, query, undefined, recordings)).results;
}

export async function searchAllDetailed(providers: MusicProvider[], query: string, signal?: AbortSignal, recordings?: RecordingCatalog): Promise<{
  results: SearchResults[]; incomplete: boolean; available: boolean;
}> {
  signal?.throwIfAborted();
  const results = await Promise.allSettled(
    providers.map((p) => signal
      ? withDeadline(Promise.resolve().then(() => { signal.throwIfAborted(); return p.search(query); }), SEARCH_PROVIDER_TIMEOUT_MS, signal)
      : withTimeout(Promise.resolve().then(() => p.search(query)), SEARCH_PROVIDER_TIMEOUT_MS, p.id)),
  );
  signal?.throwIfAborted();
  const filtered = filterPreviewResults(
    results
      .filter((r): r is PromiseFulfilledResult<SearchResults> => r.status === "fulfilled")
      .map((r) => r.value),
    isExcludePreviewsEnabled(),
  );
  if (recordings && filtered.length > 1) {
    const tracks = filtered.flatMap((result) => result.tracks.slice(0, 30));
    const used = new Set<string>();
    for (const track of tracks) {
      if (used.has(track.id)) continue;
      const matches = tracks.filter((candidate) => verifiedRecordingMatch(track, candidate));
      const match = matches.length === 1 ? matches[0] : undefined;
      if (!match || used.has(match.id) || tracks.filter((candidate) => verifiedRecordingMatch(match, candidate)).length !== 1) continue;
      used.add(track.id);
      used.add(match.id);
      await recordings.associate(track, match).catch(() => {});
    }
  }
  const normalized = normalizeSearchResults(filtered, query);
  if (recordings && filtered.length > 1) {
    for (const result of normalized) {
      const unique = new Map<string, Track>();
      for (const track of result.tracks) {
        const resolved = recordings.resolve(track);
        if (!unique.has(resolved.id)) unique.set(resolved.id, resolved);
      }
      result.tracks = [...unique.values()];
    }
  }
  return { results: normalized, incomplete: results.some((r) => r.status === "rejected"),
    available: results.some((r) => r.status === "fulfilled") };
}

export async function radioTracks(services: AppServices, seed: Track, excluded: readonly Track[] = []): Promise<Track[]> {
  if (offlineEnabled()) return [];
  const source = playbackSource(seed);
  const { detectMoods, getSpotifyGenres, getMoodProfile } = await import("../core/recommendations/moodTaxonomy");
  const moods = detectMoods(source.genre ? [source.genre] : [], source.title, source.artist);
  const spotifyGenres = getSpotifyGenres(moods);
  const moodProfile = getMoodProfile(moods);
  const moodOptions = {
    moods,
    genres: spotifyGenres.slice(0, 2),
    targetEnergy: (moodProfile.energy[0] + moodProfile.energy[1]) / 2,
    targetValence: (moodProfile.valence[0] + moodProfile.valence[1]) / 2,
    targetAcousticness: (moodProfile.acousticness[0] + moodProfile.acousticness[1]) / 2,
  };
  const options = { strict: true, excluded: [seed, source, ...excluded], feedback: getRecommendationFeedback(), annotate: true };
  const providers = services.providers.filter((provider) => FULL_PLAYBACK_PROVIDERS.has(provider.id));
  const available = (tracks: Track[]) => tracks.filter((track) =>
    !isTrackBlocked(track.id) && !isArtistBlocked(track.artist) && !track.meta?.preview,
  );
  const collect = async (request: (provider: MusicProvider) => Promise<Track[]> | undefined) =>
    (await Promise.allSettled(providers.map((provider) => withDeadline(
      Promise.resolve().then(() => request(provider) ?? []), 9_000,
    )))).flatMap((result) => result.status === "fulfilled" ? result.value : []);

  const similar = await collect((provider) => provider.getSimilarTracks?.(source.artist ?? "", source.title, moodOptions, source));
  let shortlist = rankCandidates(source, available(similar), 18, options);
  if (shortlist.length < 6 && source.artist) {
    const top = await collect((provider) => provider.getArtistTopTracks?.(source.artist!));
    shortlist = rankCandidates(source, available([...shortlist, ...top]), 18, options);
  }

  const resolved = await Promise.allSettled(shortlist.map(async (candidate) => {
    if (candidate.meta?.noPlay !== true && candidate.uri) return candidate;
    const query = `${candidate.artist ?? ""} ${candidate.title}`.trim();
    const tracks = await collect(async (provider) => (await provider.search(query)).tracks);
    const exact = available(tracks).find((match) => match.uri && !match.meta?.noPlay && sameRecording(candidate, match));
    return exact ? { ...exact, meta: { ...exact.meta, relatedTo: candidate.meta?.relatedTo, relatedRank: candidate.meta?.relatedRank } } : null;
  }));
  if (offlineEnabled()) return [];
  return rankCandidates(source, available(resolved.flatMap((result) =>
    result.status === "fulfilled" && result.value ? [result.value] : [],
  )), 12, options);
}
