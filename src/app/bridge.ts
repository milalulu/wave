import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { RepeatMode, Track } from "../core/types";
import { radioTracks, searchAll, type AppServices } from "./compose";
import { findTrackVariants } from "./trackVariants";
import {
  activeProviders,
  getBlockedArtists,
  getBlockedProviders,
  getBlockedTrackIds,
  getPreferredProviders,
  KNOWN_PROVIDERS,
  setBlockedProviders,
  setPreferredProviders,
  toggleBlockedArtist,
  toggleBlockedTrack,
} from "./platformSettings";

interface BridgeRequest {
  id: number;
  action: string;
  payload?: Record<string, unknown>;
}

export class ApiBridge {
  private unlisten: UnlistenFn | null = null;

  constructor(private services: AppServices) {}

  async start(): Promise<void> {
    this.unlisten = await listen("api-request", (event) => {
      void this.handle(event.payload as BridgeRequest);
    });
  }

  async stop(): Promise<void> {
    this.unlisten?.();
    this.unlisten = null;
  }

  private async handle(req: BridgeRequest): Promise<void> {
    let data: unknown;
    let error: string | null = null;
    try {
      data = await this.dispatch(req.action, req.payload ?? {});
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    try {
      await invoke("api_respond", {
        id: req.id,
        value: error ? { ok: false, error } : { ok: true, data },
      });
    } catch (e) {
      console.error("api_respond failed", e);
    }
  }

  private async dispatch(action: string, payload: Record<string, unknown>): Promise<unknown> {
    const { engine, providers, history } = this.services;
    switch (action) {
      case "player.status":
        return engine.snapshot;
      case "player.play":
        return this.actionPlay(payload);
      case "player.pause":
        engine.pause();
        return engine.snapshot;
      case "player.resume":
        await engine.play();
        return engine.snapshot;
      case "player.next":
        await engine.next();
        return engine.snapshot;
      case "player.previous":
        await engine.previous();
        return engine.snapshot;
      case "player.seek":
        engine.seek(asNumber(payload.position_seconds));
        return engine.snapshot;
      case "player.volume":
        engine.setVolume(asNumber(payload.percent) / 100);
        return engine.snapshot;
      case "player.shuffle":
        engine.setShuffle(Boolean(payload.enabled));
        return engine.snapshot;
      case "player.repeat":
        engine.setRepeat(payload.mode as RepeatMode);
        return engine.snapshot;
      case "queue.list":
        return { queue: engine.snapshot.queue, index: engine.snapshot.queueIndex };
      case "queue.add":
        this.queueAdd(payload);
        return { ok: true };
      case "queue.insertNext":
        this.queueInsertNext(payload);
        return { ok: true };
      case "queue.clear":
        engine.clearQueue();
        return { ok: true };
      case "search.query":
        return { results: await searchAll(providers, String(payload.query ?? "")) };
      case "search.play":
        return this.searchPlay(payload);
      case "library.like":
        return this.like(payload);
      case "history.list":
        return { history: await history.getHistory() };
      case "wave.start":
        return this.waveStart();
      case "variants.list":
        return this.variantsList();
      case "sources.list":
        return {
          blocked: getBlockedProviders(),
          preferred: getPreferredProviders(),
          known: KNOWN_PROVIDERS,
        };
      case "sources.set":
        return this.sourcesSet(payload);
      case "player.radio":
        return this.radio(payload);
      case "player.similar":
        return this.similar(payload);
      case "lyrics.list":
        return this.lyrics(payload);
      case "download.track":
        return this.download(payload);
      case "blocks.tracks":
        return { blocked: getBlockedTrackIds() };
      case "blocks.track.toggle":
        return this.toggleBlockTrack(payload);
      case "blocks.artists":
        return { blocked: getBlockedArtists() };
      case "blocks.artist.toggle":
        return this.toggleBlockArtist(payload);
      default:
        throw new Error(`unknown action: ${action}`);
    }
  }

  private async actionPlay(payload: Record<string, unknown>): Promise<unknown> {
    const { engine } = this.services;
    if (payload.track) {
      await engine.playTrack(payload.track as unknown as Track);
    } else if (Array.isArray(payload.queue)) {
      await engine.playTracks(payload.queue as unknown as Track[], asNumber(payload.index));
    } else {
      throw new Error("play requires track or queue");
    }
    return engine.snapshot;
  }

  private queueAdd(payload: Record<string, unknown>): void {
    const track = payload.track as unknown as Track;
    if (track) {
      this.services.engine.addToQueue(track, Boolean(payload.play));
    }
  }

  private queueInsertNext(payload: Record<string, unknown>): void {
    const track = payload.track as unknown as Track;
    if (track) {
      this.services.engine.playNext(track);
    }
  }

  private async searchPlay(payload: Record<string, unknown>): Promise<unknown> {
    const query = String(payload.query ?? "");
    const results = await searchAll(this.services.providers, query);
    const tracks = results.flatMap((r) => r.tracks).filter((t) => !t.meta?.noPlay);
    if (tracks.length === 0) throw new Error("nothing found");
    const index = asNumber(payload.index);
    const start = index >= 0 && index < tracks.length ? index : 0;
    await this.services.engine.playTracks(tracks, start);
    return { track: tracks[start], count: tracks.length };
  }

  private async like(payload: Record<string, unknown>): Promise<unknown> {
    const current = this.services.engine.snapshot.current;
    const track = (payload.track as unknown as Track) ?? current;
    if (!track) throw new Error("no track to like");
    const liked = await this.services.library.toggleLike(track);
    return { liked, trackId: track.id };
  }

  private async waveStart(): Promise<unknown> {
    const tracks = await this.services.wave.generateWave(20);
    if (tracks.length === 0) {
      const storage = this.services.storage;
      const liked = await storage.getLikedTracks();
      const history = await storage.getHistory(100);
      throw new Error(
        `wave is empty (liked=${liked.length}, history=${history.length})`,
      );
    }
    await this.services.engine.playTracks(tracks);
    return { count: tracks.length };
  }

  private async variantsList(): Promise<unknown> {
    const current = this.services.engine.snapshot.current;
    if (!current) return { variants: [] };
    const found = await findTrackVariants(this.services.providers, current);
    return { trackId: current.id, variants: found.map((v) => ({ provider: v.providerId, track: v.track })) };
  }

  private async sourcesSet(payload: Record<string, unknown>): Promise<unknown> {
    if (Array.isArray(payload.blocked)) {
      setBlockedProviders(payload.blocked.filter((x): x is string => typeof x === "string"));
    }
    if (Array.isArray(payload.preferred)) {
      setPreferredProviders(payload.preferred.filter((x): x is string => typeof x === "string"));
    }
    const providers = this.services.providers;
    const next = activeProviders(providers);
    providers.length = 0;
    providers.push(...next);
    return {
      blocked: getBlockedProviders(),
      preferred: getPreferredProviders(),
    };
  }

  private async radio(payload: Record<string, unknown>): Promise<unknown> {
    const seed = (payload.track as unknown as Track) ?? this.services.engine.snapshot.current;
    if (!seed) throw new Error("no track to start radio");
    const tracks = await radioTracks(this.services, seed);
    await this.services.engine.playTracks([seed, ...tracks]);
    return { count: tracks.length, seedId: seed.id };
  }

  private async similar(payload: Record<string, unknown>): Promise<unknown> {
    const seed = (payload.track as unknown as Track) ?? this.services.engine.snapshot.current;
    if (!seed) throw new Error("no track for similar");
    const tracks = await radioTracks(this.services, seed);
    for (const t of tracks) this.services.engine.addToQueue(t);
    return { added: tracks.length, seedId: seed.id };
  }

  private async lyrics(payload: Record<string, unknown>): Promise<unknown> {
    const track = (payload.track as unknown as Track) ?? this.services.engine.snapshot.current;
    if (!track) throw new Error("no track for lyrics");
    const result = await this.services.lyrics.getLyrics(track);
    return {
      trackId: track.id,
      synced: result.synced,
      instrumental: result.instrumental,
      source: result.source,
      lines: result.lines.map((l) => ({
        time: l.time ?? null,
        text: l.text,
      })),
      plainText: result.lines.map((l) => l.text).join("\n"),
    };
  }

  private async download(payload: Record<string, unknown>): Promise<unknown> {
    const track = (payload.track as unknown as Track) ?? this.services.engine.snapshot.current;
    if (!track) throw new Error("no track to download");
    const dir = typeof payload.dir === "string" ? payload.dir : "";
    if (!dir) throw new Error("dir required");
    const ext = track.meta?.audioUrl?.toString().includes(".m4a") ? "m4a" : "mp3";
    const safe = (s: string) => s.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80).trim() || "track";
    const filename = `${safe(track.artist ?? "")} - ${safe(track.title ?? "")}.${ext}`;
    const url = track.meta?.url ?? track.meta?.audioUrl?.toString() ?? track.uri ?? "";
    if (!url) throw new Error("no source url");
    await invoke("yt_download", { url, outputPath: `${dir}/${filename}` });
    return { ok: true, file: `${dir}/${filename}`, trackId: track.id };
  }

  private toggleBlockTrack(payload: Record<string, unknown>): unknown {
    const id = typeof payload.id === "string" ? payload.id : "";
    if (!id) throw new Error("track id required");
    const blocked = toggleBlockedTrack(id);
    return { blocked, list: getBlockedTrackIds() };
  }

  private toggleBlockArtist(payload: Record<string, unknown>): unknown {
    const name = typeof payload.name === "string" ? payload.name : "";
    if (!name) throw new Error("artist name required");
    const blocked = toggleBlockedArtist(name);
    return { blocked, list: getBlockedArtists() };
  }
}

function asNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}
