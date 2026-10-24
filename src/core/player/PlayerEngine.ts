import { playbackSource } from "../types";
import { StartupMeasurement, type StartupTiming } from "./StartupMeasurement";
import { EventEmitter } from "../util/EventEmitter";
import type { PlayerSnapshot, PlayerState, RepeatMode, Track } from "../types";
import type { AudioAdapter } from "./PlayerAdapter";
import { Queue } from "../queue/Queue";
import { validateStreamUrl } from "../util/validateUrl";

export interface PlayerEvents {
  startup: StartupTiming;
  state: PlayerState;
  track: Track | null;
  time: { position: number; duration: number };
  queue: { queue: Track[]; index: number; history: Track[] };
  volume: number;
  speed: number;
  equalizer: number[];
  shuffle: boolean;
  repeat: RepeatMode;
  error: string;
  ended: void;
  skipped: { position: number; duration: number; percent: number };
}

export const STALL_TIMEOUT_MS = 12000;

export const PLAY_START_TIMEOUT_MS = 10000;

const PREFETCH_BATCH = 5;
const PREFETCH_CONCURRENCY = 2;

interface PlayerEngineOptions {
  prepareTrack?: (track: Track) => Track;
  rng?: () => number;
  
  resolveUri?: (track: Track) => Promise<string>;
  
  invalidateStream?: (trackId: string) => void;
  
  retries?: number;
  
  onQueueEnd?: () => Promise<Track[]> | Track[];
  
   autoGenerateThreshold?: number;

  upgradePreview?: (track: Track) => Promise<Track | null>;
}

export class PlayerEngine extends EventEmitter<PlayerEvents> {
  private adapter: AudioAdapter;
  private queue: Queue;
  private state: PlayerState = "idle";
  private volume = 1;
  private speed = 1;
  private equalizer: number[] = [];
  private bassBoost = 0;
  private reverb = 0;
  private stereoWidth = 0;
  private repeat: RepeatMode = "off";
  private duration = 0;
  private detach: (() => void)[] = [];
  private prepareTrack: (track: Track) => Track;
  private resolveUri?: (track: Track) => Promise<string>;
  private invalidateStream?: (trackId: string) => void;
   private onQueueEnd?: () => Promise<Track[]> | Track[];
   private defaultFiller?: () => Promise<Track[]> | Track[];
   private upgradePreview?: (track: Track) => Promise<Track | null>;
   private autoGenerateThreshold: number = 3;
  
  private upgradedTrackId: string | null = null;
  private retries = 0;
  private maxRetries: number;
  private playSeq = 0;
  private disposed = false;
  private preloadCache = new Map<string, string | Promise<string | undefined>>();
  private prefetchedIds = new Set<string>();
  private prefetchInFlight = false;
  private preloadedId: string | null = null;
  private stallTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
  private consecutiveFails = 0;
  private static MAX_CONSECUTIVE_FAILS = 5;
  
  private fallback?: () => Track | null;
  private fallbackUsed = false;
  
  private fallbackTrackId: string | null = null;
  
  private pauseAtEnd = false;
  
  private hasSource = false;
  private queueUpdateScheduled = false;
  

  private restorePos = 0;
  private restorePosTrackId: string | null = null;

  constructor(adapter: AudioAdapter, options: PlayerEngineOptions = {}) {
    super();
    this.adapter = adapter;
    this.prepareTrack = options.prepareTrack ?? ((track) => track);
    this.resolveUri = options.resolveUri;
    this.invalidateStream = options.invalidateStream;
     this.onQueueEnd = options.onQueueEnd;
     this.defaultFiller = options.onQueueEnd;
     this.upgradePreview = options.upgradePreview;
     this.maxRetries = Math.max(0, options.retries ?? 1);
     if (options.autoGenerateThreshold !== undefined) this.autoGenerateThreshold = options.autoGenerateThreshold;
     this.queue = new Queue({ rng: options.rng });
     this.attachAdapter();
  }

  private attachAdapter(): void {
    this.detach.push(
      this.adapter.onStateChange((s) => this.setState(s)),
      this.adapter.onTimeUpdate((position, duration) => {
        this.duration = duration;
        this.emit("time", { position, duration });
        const remaining = duration - position;
        if (remaining < 30 && remaining > 0) {
          void this.preloadNext();
        }
        void this.maybeUpgradePreview(duration);
      }),
      this.adapter.onEnded(() => this.onTrackEnded()),
      this.adapter.onError((message) => this.onLoadError(message, this.playSeq)),
    );
  }

  private setState(state: PlayerState): void {
    if (this.state === state) return;
    this.state = state;
    if (state === "loading") {
      this.startStallTimer();
    } else {
      this.clearStallTimer();
    }
    this.emit("state", state);
  }

  
  private startStallTimer(): void {
    this.clearStallTimer();
    this.stallTimer = globalThis.setTimeout(() => {
      this.onLoadError("stream stalled", this.playSeq);
    }, STALL_TIMEOUT_MS);
  }

  private clearStallTimer(): void {
    if (this.stallTimer !== undefined) {
      globalThis.clearTimeout(this.stallTimer);
      this.stallTimer = undefined;
    }
  }

  get snapshot(): PlayerSnapshot {
    const current = this.queue.current();
    return {
      state: this.state,
      current,
      position: this.adapter.getPosition(),
      duration: current?.duration ?? this.duration,
      volume: this.volume,
      speed: this.speed,
       equalizer: [...this.equalizer],
      bassBoost: this.bassBoost,
      reverb: this.reverb,
      stereoWidth: this.stereoWidth,
      shuffle: this.queue.isShuffle,
      repeat: this.repeat,
      queue: this.queue.tracksList,
      queueIndex: this.queue.currentIndex(),
      history: this.queue.historyList,
    };
  }

  
  async playTracks(tracks: Track[], startIndex = 0): Promise<void> {
    if (tracks.length === 0) return;
    this.queue.replace(tracks.map(this.prepareTrack), startIndex);
    
    this.preloadCache.clear();
    this.preloadedId = null;
    this.fallbackUsed = false;
    this.fallbackTrackId = null;
    this.upgradedTrackId = null;
    
    this.restorePos = 0;
    this.restorePosTrackId = null;
    await this.playCurrent();
  }

  

  async restoreQueue(queue: Track[], index: number, position = 0): Promise<void> {
    if (queue.length === 0) return;
    const clamped = Math.min(Math.max(index, 0), queue.length - 1);
    this.queue.replace(queue.map(this.prepareTrack), clamped);
    this.preloadCache.clear();
    this.preloadedId = null;
    this.fallbackUsed = false;
    this.fallbackTrackId = null;
    this.upgradedTrackId = null;
    const track = this.queue.current();
    if (!track) return;
    const seq = ++this.playSeq;
    this.hasSource = false;
    this.clearStallTimer();
    this.adapter.pause();
    this.setState("paused");
    this.duration = playbackSource(track).duration ?? track.duration ?? 0;
    // The resolver must recheck the selected source, offline policy and expiring URLs.
    const uri = this.resolveUri ? "" : this.directUri(track);
    if (uri) {
      try {
        await this.adapter.load(uri);
        if (seq !== this.playSeq) return;
        this.hasSource = true;
      } catch {
        if (seq !== this.playSeq) return;
      }
    }
    this.restorePos = 0;
    this.restorePosTrackId = null;
    if (position > 0) {
      this.restorePos = position;
      this.restorePosTrackId = track.id;
      try {
        this.adapter.seek(position);
      } catch {
        
      }
    }
    this.emit("track", track);
    this.emitQueue();
  }

  private directUri(track: Track): string {
    const u = playbackSource(track).uri;
    if (!u) return "";
    if (!(u.startsWith("http://") || u.startsWith("https://") || u.startsWith("asset://"))) return "";
    
    
    
    if (this.isYouTubePage(u)) return "";
    return u;
  }

  private isYouTubePage(u: string): boolean {
    return (
      /^https?:\/\/(?:www\.|m\.|music\.)?youtube\.com\/(?:watch|embed|shorts|live)\b/i.test(u) ||
      /^https?:\/\/(?:www\.)?youtu\.be\//i.test(u)
    );
  }

  async playTrack(track: Track): Promise<void> {
    await this.playTracks([track], 0);
  }

  async playNext(track: Track): Promise<boolean> {
    const hasCurrent = this.queue.current() !== null;
    const added = this.queue.insertNext(this.prepareTrack(track));
    this.emitQueue();
    if (!hasCurrent) {
      await this.playCurrent();
    }
    return added;
  }

  
  playVariant(track: Track, preservePosition = false): void {
    if (preservePosition) {
      this.restorePos = this.adapter.getPosition();
      this.restorePosTrackId = track.id;
    }
    if (!this.queue.replaceCurrent(track)) return;
    this.emitQueue();
    if (preservePosition && this.state === "paused") {
      this.playSeq += 1;
      this.clearStallTimer();
      this.hasSource = false;
      this.emit("track", track);
      return;
    }
    void this.playCurrent(false);
  }

  async play(): Promise<void> {
    if (!this.queue.current()) {
      if (!this.queue.length) return;
      this.queue.restart();
      this.hasSource = false;
    }
    if (this.state === "paused") {
      this.setState("loading");
    }
    try {
      
      
      if (this.hasSource) {
        await this.playWithGuard();
      } else {
        await this.playCurrent();
      }
    } catch (err) {
      
      
      this.onLoadError(err instanceof Error ? err.message : String(err), this.playSeq);
    }
  }

  get playbackRevision(): number { return this.playSeq; }

  pause(): void {
    this.playSeq += 1;
    this.setState("paused");
    this.adapter.pause();
  }

  async togglePlay(): Promise<void> {
    if (this.state === "playing") {
      this.pause();
    } else {
      await this.play();
    }
  }

  async next(userInitiated = false): Promise<void> {
    const request = this.playSeq;
    if (userInitiated) {
      const position = this.adapter.getPosition();
      const duration = this.adapter.getDuration();
      if (duration > 0) {
        this.emit("skipped", { position, duration, percent: position / duration });
      }
    }
    const nextTrack = this.queue.next();
    if (nextTrack) {
      await this.playCurrent();
    } else if (this.repeat === "all" && this.queue.length > 0) {
      this.queue.restart();
      await this.playCurrent();
    } else if (this.onQueueEnd) {
      const oldLength = this.queue.length;
      try {
        const more = await this.onQueueEnd();
        if (request !== this.playSeq || this.disposed) return;
        if (more.length > 0) {
          for (const t of more) this.queue.append(this.prepareTrack(t));
          const orderPos = this.queue.positionOf(oldLength);
          if (orderPos >= 0) this.queue.jumpToOrderPos(orderPos);
          await this.playCurrent();
          return;
        }
      } catch {
        
      }
      if (request !== this.playSeq || this.disposed) return;
      this.stopAtEnd();
    } else {
      this.stopAtEnd();
    }
  }

  private stopAtEnd(): void {
    this.playSeq += 1;
    this.clearStallTimer();
    this.adapter.pause();
    this.hasSource = false;
    this.queue.clear();
    this.emit("queue", { queue: [], index: -1, history: [] });
  }

  async previous(): Promise<void> {
    const prev = this.queue.previous();
    if (prev) {
      await this.playCurrent();
    } else {
      this.adapter.seek(0);
    }
  }

  seek(seconds: number): void {
    this.adapter.seek(seconds);
  }

  setVolume(volume: number): void {
    this.volume = Math.min(Math.max(volume, 0), 1);
    this.adapter.setVolume(this.volume);
    this.emit("volume", this.volume);
  }

  setPlaybackRate(rate: number): void {
    this.speed = Math.min(Math.max(rate, 0.5), 2);
    this.adapter.setPlaybackRate(this.speed);
    this.emit("speed", this.speed);
  }

  setEqualizer(gains: number[]): void {
    this.equalizer = [...gains];
    this.adapter.setEqualizer(this.equalizer);
    this.emit("equalizer", this.equalizer);
  }

  setLeveling(enabled: boolean, targetDb: number): void {
    this.adapter.setLeveling(enabled, targetDb);
  }

  setCrossfadeMs(ms: number): void {
    this.adapter.setCrossfadeMs(ms);
  }

   setBassBoost(db: number): void {
    this.bassBoost = db;
    this.adapter.setBassBoost(db);
  }

  setReverb(mix: number): void {
    this.reverb = mix;
    this.adapter.setReverb(mix);
  }

   setStereoWidth(pan: number): void {
     this.stereoWidth = pan;
     this.adapter.setStereoWidth(pan);
   }

  setAutoGenerateThreshold(threshold: number): void {
    this.autoGenerateThreshold = Math.max(1, threshold);
  }

  preResolve(tracks: Track[]): void {
    if (!this.resolveUri) return;
    for (const track of tracks.slice(0, 5)) {
      if (this.prefetchedIds.has(track.id) || this.preloadCache.has(track.id)) continue;
      if (!track.uri) continue;
      const promise = this.resolveUri(track).then((uri) => {
        this.prefetchedIds.add(track.id);
        return uri;
      }).catch(() => {
        this.preloadCache.delete(track.id);
        return undefined;
      });
      this.preloadCache.set(track.id, promise);
    }
  }

   
   setPauseAfterTrack(on: boolean): void {
    this.pauseAtEnd = on;
  }

  private applyAudioSettings(): void {
    this.adapter.setEqualizer(this.equalizer);
    this.adapter.setBassBoost(this.bassBoost);
    this.adapter.setReverb(this.reverb);
    this.adapter.setStereoWidth(this.stereoWidth);
  }

  
  getSpectrum(data: Uint8Array): void {
    this.adapter.getSpectrum(data);
  }

  setShuffle(on: boolean): void {
    this.queue.setShuffle(on);
    this.emit("shuffle", on);
    this.emitQueue();
  }

  setRepeat(mode: RepeatMode): void {
    this.repeat = mode;
    this.emit("repeat", mode);
  }

  
  setAutoFill(fn: (() => Promise<Track[]> | Track[]) | null): void {
    this.onQueueEnd = fn ?? this.defaultFiller;
  }

  
  setFallback(fn: (() => Track | null) | null): void {
    this.fallback = fn ?? undefined;
    this.fallbackUsed = false;
  }

  addToQueue(track: Track, play = false): boolean {
    const added = this.queue.append(this.prepareTrack(track));
    if (play) {
      const trackIndex = this.queue.length - 1;
      const pos = this.queue.positionOf(trackIndex);
      if (pos >= 0) this.queue.jumpToOrderPos(pos);
      void this.playCurrent();
    }
    this.emitQueue();
    void this.prefetchBatch();
    return added;
  }

  removeFromQueue(trackIndex: number): void {
    this.queue.removeAt(trackIndex);
    this.emitQueue();
  }

  insertAtQueueIndex(trackIndex: number, track: Track): void {
    this.queue.insertAt(trackIndex, this.prepareTrack(track));
    this.emitQueue();
    void this.prefetchBatch();
  }

  moveInQueue(fromIndex: number, toIndex: number): void {
    this.queue.move(fromIndex, toIndex);
    this.emitQueue();
  }

  
  updateTrack(id: string, patch: Partial<Track>): void {
    if (this.queue.replaceTrackFields(id, patch)) this.emitQueue();
  }

  clearQueue(): void {
    this.playSeq += 1;
    this.clearStallTimer();
    this.queue.clear();
    this.hasSource = false;
    this.adapter.pause();
    this.setState("idle");
    this.emit("track", null);
    this.emitQueue();
  }

  dedupeQueue(): number {
    const removed = this.queue.dedupe();
    if (removed > 0) this.emitQueue();
    return removed;
  }

  destroy(): void {
    this.disposed = true;
    this.playSeq += 1;
    this.clearStallTimer();
    this.detach.forEach((d) => d());
    this.detach = [];
    this.adapter.destroy();
    this.clear();
  }

  private async playCurrent(usePreference = true): Promise<void> {
    const selected = this.queue.current();
    if (!selected) return;
    const track = usePreference ? this.prepareTrack(selected) : selected;
    if (track !== selected) this.queue.replaceCurrent(track);
    if (track.id !== this.fallbackTrackId) {
      this.fallbackUsed = false;
    }
    this.playSeq += 1;
    this.hasSource = false;
    this.retries = 0;
    this.consecutiveFails = 0;
    void this.maybeRefillQueue();
    await this.startTrack(this.playSeq);
    void this.preloadNext();
  }

  
  private onLoadError(message: string, seq: number): void {
    if (seq !== this.playSeq || !this.queue.current()) return;
    if (this.state === "paused") return;

    const isMediaError = message.startsWith("audio error code");
    const isStreamError = message.includes("403") || message.includes("stream URL returned");
    if (isMediaError || isStreamError) {
      const track = this.queue.current();
      if (track && this.invalidateStream) {
        this.invalidateStream(playbackSource(track).id);
      }
    }

    if (this.resolveUri && this.retries < this.maxRetries) {
      this.retries += 1;
      void this.startTrack(seq);
      return;
    }

    this.consecutiveFails += 1;
    if (this.consecutiveFails >= PlayerEngine.MAX_CONSECUTIVE_FAILS) {
      this.clearStallTimer();
      this.emit("error", "too many failed tracks in a row, stopping");
      this.consecutiveFails = 0;
      this.stopAtEnd();
      return;
    }

    const current = this.queue.current();
    if (this.fallback && !this.fallbackUsed && current) {
      this.fallbackUsed = true;
      this.fallbackTrackId = current.id;
      const fb = this.fallback();
      if (fb && this.queue.replaceCurrent(fb)) {
        this.emitQueue();
        void this.playCurrent(false);
        return;
      }
    }
    this.fallbackUsed = false;
    this.clearStallTimer();
    this.emit("error", message);
    void this.next();
  }

  private async startTrack(seq: number): Promise<void> {
    const track = this.queue.current();
    if (this.disposed || !track || seq !== this.playSeq) return;
    this.setState("loading");
    this.startStallTimer();
    this.emit("track", track);
    const timing = new StartupMeasurement(playbackSource(track).provider);
    let outcome: StartupTiming["outcome"] = "cancelled";
    try {
      const cached = this.preloadCache.get(track.id);
      if (cached) {
        this.preloadCache.delete(track.id);
      }
      this.clearStallTimer();
      // The application resolver rechecks policy, quality and signed-URL expiry.
      // A prefetched URL must never bypass those checks when playback begins.
      const uri = await timing.measure("resolve", async () => this.resolveUri
        ? this.resolveUri(track) : cached ? await cached : playbackSource(track).uri);
      if (!uri) throw new Error("no stream URL");
      if (seq !== this.playSeq) return;

      await timing.measure("validate", () => validateStreamUrl(uri));
      if (seq !== this.playSeq) return;
      await timing.measure("load", () => this.adapter.load(uri,
        this.resolveUri ? () => this.resolveUri!(track) : undefined));
      if (seq !== this.playSeq) return;
      this.hasSource = true;
      this.startStallTimer();
      this.duration = playbackSource(track).duration ?? track.duration ?? 0;
      void this.applyAudioSettings();
      
      
      if (this.restorePosTrackId === track.id && this.restorePos > 0) {
        try {
          this.adapter.seek(this.restorePos);
        } catch {
          
        }
        this.restorePosTrackId = null;
        this.restorePos = 0;
      }
      await timing.measure("play", () => this.playWithGuard());
      if (seq === this.playSeq) outcome = "playing";
    } catch (err) {
      if (seq === this.playSeq) outcome = "failed";
      this.onLoadError(err instanceof Error ? err.message : String(err), seq);
    } finally {
      this.emit("startup", timing.finish(outcome));
    }
    this.emitQueue();
  }

  

  private async playWithGuard(): Promise<void> {
    let settled = false;
    let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = globalThis.setTimeout(() => {
        settled = true;
        reject(new Error("play() timed out"));
      }, PLAY_START_TIMEOUT_MS);
    });
    const play = this.adapter.play().then(
      () => {
        if (timer !== undefined) globalThis.clearTimeout(timer);
      },
      (err: unknown) => {
        if (timer !== undefined) globalThis.clearTimeout(timer);
        if (settled) return;
        throw err;
      },
    );
    await Promise.race([play, timeout]);
  }

  

  private async maybeUpgradePreview(streamDuration: number): Promise<void> {
    if (!this.upgradePreview) return;
    if (this.state !== "playing" && this.state !== "loading") return;
    const track = this.queue.current();
    if (!track || track.id === this.upgradedTrackId) return;
    const declared = track.duration ?? 0;
    if (declared <= 0) return;
    if (!Number.isFinite(streamDuration) || streamDuration <= 0) return;
    
    if (!(streamDuration <= 60 && declared - streamDuration >= 30)) return;
    this.upgradedTrackId = track.id;
    try {
      const full = await this.upgradePreview(track);
      if (!full) return;
      const cur = this.queue.current();
      if (!cur || cur.id !== track.id) return;
      if (this.state !== "playing" && this.state !== "loading") return;
      if (this.queue.replaceCurrent(full)) {
        this.emitQueue();
        await this.playCurrent(false);
      }
    } catch {
      
    }
  }

  
  private async preloadNext(): Promise<void> {
    if (!this.resolveUri) return;
    const queued = this.queue.peekNext();
    const next = queued ? this.prepareTrack(queued) : null;
    if (!next || this.preloadedId === next.id || this.preloadCache.has(next.id)) return;
    if (next.uri) {
      this.preloadedId = next.id;
      try {
        const uri = await this.resolveUri(next);
        if (this.preloadedId === next.id) {
          this.preloadCache.set(next.id, uri);
          this.adapter.preload(uri);
        }
      } catch {
        
      }
    }
  }

  private async prefetchBatch(): Promise<void> {
    if (!this.resolveUri || this.prefetchInFlight) return;
    const upcoming = this.queue.peekAhead(PREFETCH_BATCH).map(this.prepareTrack);
    if (upcoming.length === 0) return;
    const toFetch = upcoming.filter((t) => !this.prefetchedIds.has(t.id) && !this.preloadCache.has(t.id));
    if (toFetch.length === 0) return;
    this.prefetchInFlight = true;
    try {
      const seq = this.playSeq;
      let active = 0;
      let idx = 0;
      await new Promise<void>((resolve) => {
        const next = () => {
          while (active < PREFETCH_CONCURRENCY && idx < toFetch.length) {
            const track = toFetch[idx++];
            if (!track.uri) continue;
            active++;
            const promise = this.resolveUri!(track).then(
              (uri) => {
                this.prefetchedIds.add(track.id);
                return uri;
              },
              () => {
                this.preloadCache.delete(track.id);
                return undefined;
              },
            );
            this.preloadCache.set(track.id, promise);
            promise.finally(() => {
              active--;
              if (seq !== this.playSeq || (active === 0 && idx >= toFetch.length)) {
                resolve();
              } else {
                next();
              }
            });
          }
          if (active === 0 && idx >= toFetch.length) resolve();
        };
        next();
      });
      if (seq !== this.playSeq) return;
      const first = upcoming[0];
      if (first) {
        const firstUri = this.preloadCache.get(first.id);
        if (typeof firstUri === "string") {
          this.adapter.preload(firstUri);
        } else if (firstUri instanceof Promise) {
          firstUri.then((uri) => { if (seq === this.playSeq && uri) this.adapter.preload(uri); }).catch(() => {});
        }
      }
    } finally {
      this.prefetchInFlight = false;
    }
  }

  private maybeRefillQueue(): void {
    const remaining = this.queue.remainingCount();
    if (remaining >= this.autoGenerateThreshold) return;
    if (!this.onQueueEnd) return;
    void this.refillQueue();
  }

  private async refillQueue(): Promise<void> {
    const seq = this.playSeq;
    try {
      const more = await this.onQueueEnd!();
      if (seq !== this.playSeq) return;
      if (more.length > 0) {
        for (const t of more) this.queue.append(this.prepareTrack(t));
        this.emitQueue();
        void this.preloadNext();
      }
    } catch (err) {
      this.emit("error", `auto-fill failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async onTrackEnded(): Promise<void> {
    
    const stop = this.pauseAtEnd;
    this.emit("ended", undefined);
    if (stop) {
      this.pauseAtEnd = false;
      this.adapter.pause();
      
      this.setState("paused");
      return;
    }
    if (this.repeat === "one") {
      this.adapter.seek(0);
      await this.play();
      return;
    }
    await this.next();
  }

  private emitQueue(): void {
    if (this.queueUpdateScheduled) return;
    this.queueUpdateScheduled = true;
    queueMicrotask(() => {
      this.queueUpdateScheduled = false;
      this.emit("queue", {
        queue: this.queue.tracksList,
        index: this.queue.currentIndex(),
        history: this.queue.historyList,
      });
    });
  }
}
