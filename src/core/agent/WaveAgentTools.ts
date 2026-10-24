import type { Storage } from "../database/Storage";
import type { PlayerEngine } from "../player/PlayerEngine";
import type { Playlist, Track } from "../types";
import type { AgentPage, AgentPlaylist, AgentStatus, AgentTrack, ToolCall, ToolName, ToolResult } from "./contract";
import type { AgentToolHandler } from "./AgentExecutor";
import { AgentFault, ExecutionScope } from "./execution";

/** Trusted application port; mutations must update the same state as ordinary UI controls. */
export interface WaveAgentHost {
  engine: PlayerEngine;
  storage: Storage;
  search(query: string, signal: AbortSignal): Promise<{ tracks: Track[]; incomplete: boolean }>;
  prepareTrack(track: Track): Track;
  playable(track: Track): boolean;
  play(tracks: Track[], signal: AbortSignal): Promise<void>;
  playback(action: "resume" | "next" | "previous", signal: AbortSignal): Promise<void>;
  pause(): void;
  clearQueue(): void;
  setVolume(percent: number): void;
  setSpeed(rate: number): void;
  setEqualizer(gains: number[]): void;
  createPlaylist(name: string, signal: AbortSignal): Promise<Playlist>;
  addToPlaylist(id: string, track: Track, signal: AbortSignal): Promise<boolean>;
  setLiked(track: Track, liked: boolean, signal: AbortSignal): Promise<boolean>;
  radio(artist: string, signal: AbortSignal): Promise<{ artist: string; trackCount: number }>;
}

class References<T> {
  private values = new Map<string, { identity: string; value: T }>();
  private sequence = 0;
  private readonly prefix = crypto.randomUUID();
  put(identity: string, value: T): string {
    for (const [id, entry] of this.values) {
      if (entry.identity === identity) { entry.value = structuredClone(value); return id; }
    }
    if (this.values.size >= 256) this.values.delete(this.values.keys().next().value!);
    const id = `${this.prefix}:${++this.sequence}`;
    this.values.set(id, { identity, value: structuredClone(value) });
    return id;
  }
  get(id: string): T {
    const entry = this.values.get(id);
    if (!entry) throw new AgentFault("unknown_reference");
    return structuredClone(entry.value);
  }
  clear(): void { this.values.clear(); }
}

// Metadata may contain control characters; remove them before exposing labels to a model.
// eslint-disable-next-line no-control-regex
const label = (value: string | undefined) => (value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 300);
const duration = (value: number | undefined) => typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;

export class WaveAgentTools implements AgentToolHandler {
  private tracks = new References<Track>();
  private playlists = new References<string>();
  private readonly host: WaveAgentHost;
  constructor(host: WaveAgentHost) { this.host = host; }
  clear(): void { this.tracks.clear(); this.playlists.clear(); }

  private track(track: Track): AgentTrack {
    const prepared = this.host.prepareTrack(track);
    return { id: this.tracks.put(track.id, track), title: label(track.title), artist: label(track.artist),
      durationSeconds: duration(track.duration), playable: this.host.playable(prepared) };
  }
  private playlist(pl: Playlist): AgentPlaylist {
    return { id: this.playlists.put(pl.id, pl.id), name: label(pl.name), trackCount: pl.trackIds.length };
  }
  private status(): AgentStatus {
    const s = this.host.engine.snapshot;
    return { state: s.state, current: s.current ? this.track(s.current) : null,
      positionSeconds: s.position, durationSeconds: duration(s.duration), volumePercent: s.volume * 100,
      shuffle: s.shuffle, repeat: s.repeat, speed: s.speed,
      gainsDb: Array.from({ length: 10 }, (_, i) => s.equalizer[i] ?? 0) };
  }
  private knownTrack(id: string, mustPlay = false): Track {
    const track = this.host.prepareTrack(this.tracks.get(id));
    if (mustPlay && !this.host.playable(track)) throw new AgentFault("not_playable");
    return track;
  }
  private async knownPlaylist(id: string, scope: ExecutionScope): Promise<Playlist> {
    const pl = await this.host.storage.getPlaylist(this.playlists.get(id));
    scope.check();
    if (!pl) throw new AgentFault("not_found");
    return pl;
  }
  private page<T, R>(values: T[], offset: number, limit: number, project: (value: T) => R): AgentPage<R> {
    return { items: values.slice(offset, offset + limit).map(project), nextOffset: offset + limit < values.length ? offset + limit : null };
  }

  async run(call: ToolCall, scope: ExecutionScope): Promise<ToolResult<ToolName>> {
    scope.check();
    const h = this.host;
    const e = h.engine;
    // The union return is checked at each branch; no model-provided object reaches a service.
    switch (call.name) {
      case "wave_status": return { ok: true, data: this.status() };
      case "wave_search": {
        const found = await h.search(call.args.query, scope.signal);
        scope.check();
        const seen = new Set<string>();
        const tracks = found.tracks.filter((t) => !seen.has(t.id) && Boolean(seen.add(t.id))).slice(0, call.args.limit);
        return { ok: true, data: { tracks: tracks.map((t) => this.track(t)), incomplete: found.incomplete } };
      }
      case "wave_queue": {
        const s = e.snapshot;
        return { ok: true, data: { ...this.page(s.queue, call.args.offset, call.args.limit, (t) => this.track(t)), currentIndex: s.queueIndex } };
      }
      case "wave_playlists": {
        const list = await h.storage.getPlaylists(); scope.check();
        return { ok: true, data: this.page(list, call.args.offset, call.args.limit, (pl) => this.playlist(pl)) };
      }
      case "wave_playlist_get": {
        const pl = await this.knownPlaylist(call.args.playlistId, scope);
        return { ok: true, data: { ...this.playlist(pl), ...this.page(pl.tracks ?? [], call.args.offset, call.args.limit, (t) => this.track(t)) } };
      }
      case "wave_liked": {
        const tracks = await h.storage.getLikedTracks(); scope.check();
        return { ok: true, data: this.page(tracks, call.args.offset, call.args.limit, (t) => this.track(t)) };
      }
      case "wave_play": {
        const track = this.knownTrack(call.args.trackId, true);
        scope.commit(); await h.play([track], scope.signal); scope.check();
        return { ok: true, data: this.status() };
      }
      case "wave_playlist_play": {
        const pl = await this.knownPlaylist(call.args.playlistId, scope);
        const tracks = (pl.tracks ?? []).map((t) => h.prepareTrack(t));
        if (!tracks.length) throw new AgentFault("empty_queue");
        if (tracks.some((t) => !h.playable(t))) throw new AgentFault("not_playable");
        scope.commit(); await h.play(tracks, scope.signal); scope.check();
        return { ok: true, data: this.status() };
      }
      case "wave_pause": scope.commit(); h.pause(); break;
      case "wave_resume": case "wave_next": case "wave_previous": {
        if (call.name === "wave_resume" ? !e.snapshot.queue.length : !e.snapshot.current) throw new AgentFault("empty_queue");
        scope.commit();
        const action = call.name === "wave_resume" ? "resume" : call.name === "wave_next" ? "next" : "previous";
        await h.playback(action, scope.signal); scope.check(); break;
      }
      case "wave_seek": {
        const s = e.snapshot;
        if (!s.current) throw new AgentFault("empty_queue");
        const length = duration(s.duration);
        if (length === null || call.args.positionSeconds > length) throw new AgentFault("out_of_range");
        scope.commit(); e.seek(call.args.positionSeconds); break;
      }
      case "wave_volume": scope.commit(); h.setVolume(call.args.percent); break;
      case "wave_shuffle": scope.commit(); e.setShuffle(call.args.enabled); break;
      case "wave_repeat": scope.commit(); e.setRepeat(call.args.mode); break;
      case "wave_speed": scope.commit(); h.setSpeed(call.args.rate); break;
      case "wave_equalizer": scope.commit(); h.setEqualizer(call.args.gainsDb); break;
      case "wave_queue_add": {
        const track = this.knownTrack(call.args.trackId, true);
        scope.commit();
        if (call.args.position === "next" && e.snapshot.current) await e.playNext(track);
        else e.addToQueue(track); // Empty queue must not start playback.
        return { ok: true, data: { trackId: this.track(track).id, queueLength: e.snapshot.queue.length } };
      }
      case "wave_queue_clear": scope.commit(); h.clearQueue(); return { ok: true, data: { queueLength: 0, state: "idle" } };
      case "wave_playlist_create": {
        scope.commit(); const pl = await h.createPlaylist(call.args.name, scope.signal);
        return { ok: true, data: this.playlist(pl) };
      }
      case "wave_playlist_add": {
        const track = this.knownTrack(call.args.trackId);
        const pl = await this.knownPlaylist(call.args.playlistId, scope);
        scope.commit(); const added = await h.addToPlaylist(pl.id, track, scope.signal);
        return { ok: true, data: { playlistId: call.args.playlistId, trackId: call.args.trackId, added } };
      }
      case "wave_like": {
        const track = this.knownTrack(call.args.trackId);
        scope.commit(); const liked = await h.setLiked(track, call.args.liked, scope.signal);
        return { ok: true, data: { trackId: call.args.trackId, liked } };
      }
      case "wave_radio": {
        scope.commit(); const station = await h.radio(call.args.artist, scope.signal); scope.check();
        return { ok: true, data: { ...station, artist: label(station.artist), state: e.snapshot.state } };
      }
      default: throw new AgentFault("unknown_tool");
    }
    return { ok: true, data: this.status() };
  }
}
