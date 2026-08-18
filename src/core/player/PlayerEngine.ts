import { EventEmitter } from "../util/EventEmitter";
import type { PlayerSnapshot, PlayerState, RepeatMode, Track } from "../types";
import type { AudioAdapter } from "./PlayerAdapter";
import { Queue } from "../queue/Queue";
import { validateStreamUrl } from "../util/validateUrl";

export interface PlayerEvents {
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
}

export const STALL_TIMEOUT_MS = 12000;

export const PLAY_START_TIMEOUT_MS = 10000;

interface PlayerEngineOptions {
  rng?: () => number;
  
  resolveUri?: (track: Track) => Promise<string>;
  
  invalidateStream?: (trackId: string) => void;
  
  retries?: number;
  
  onQueueEnd?: () => Promise<Track[]> | Track[];
  

  upgradePreview?: (track: Track) => Promise<Track | null>;
}

export class PlayerEngine extends EventEmitter<PlayerEvents> {
  private adapter: AudioAdapter;
  private queue: Queue;
  private state: PlayerState = "idle";
  private volume = 1;
  private speed = 1;
  private equalizer: number[] = [];
  private repeat: RepeatMode = "off";
  private duration = 0;
  private detach: (() => void)[] = [];
  private resolveUri?: (track: Track) => Promise<string>;
  private invalidateStream?: (trackId: string) => void;
  private onQueueEnd?: () => Promise<Track[]> | Track[];
  private defaultFiller?: () => Promise<Track[]> | Track[];
  private upgradePreview?: (track: Track) => Promise<Track | null>;
  
  private upgradedTrackId: string | null = null;
  private retries = 0;
  private maxRetries: number;
  private playSeq = 0;
  private preloadCache = new Map<string, string>();
  private preloadedId: string | null = null;
  private stallTimer: number | undefined;
  private consecutiveFails = 0;
  private static MAX_CONSECUTIVE_FAILS = 5;
  
  private fallback?: () => Track | null;
  private fallbackUsed = false;
  
  private fallbackTrackId: string | null = null;
  
  private pauseAtEnd = false;
  
  private hasSource = false;
  

  private restorePos = 0;
  private restorePosTrackId: string | null = null;

  constructor(adapter: AudioAdapter, options: PlayerEngineOptions = {}) {
    super();
    this.adapter = adapter;
    this.resolveUri = options.resolveUri;
    this.invalidateStream = options.invalidateStream;
    this.onQueueEnd = options.onQueueEnd;
    this.defaultFiller = options.onQueueEnd;
    this.upgradePreview = options.upgradePreview;
    this.maxRetries = Math.max(0, options.retries ?? 1);
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
        if (remaining < 60 && remaining > 0) {
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
      shuffle: this.queue.isShuffle,
      repeat: this.repeat,
      queue: this.queue.tracksList,
      queueIndex: this.queue.currentIndex(),
      history: this.queue.historyList,
    };
  }

  
  async playTracks(tracks: Track[], startIndex = 0): Promise<void> {
    if (tracks.length === 0) return;
    this.queue.replace(tracks, startIndex);
    
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
    this.queue.replace(queue, clamped);
    this.preloadCache.clear();
    this.preloadedId = null;
    this.fallbackUsed = false;
    this.fallbackTrackId = null;
    this.upgradedTrackId = null;
    const track = this.queue.current();
    if (!track) return;
    this.setState("paused");
    this.duration = track.duration ?? 0;
    const uri = this.directUri(track);
    if (uri) {
      this.adapter.load(uri).catch(() => {
        
        this.hasSource = false;
      });
      this.hasSource = true;
    }
    
    
    
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
    const u = track.uri;
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

  async playNext(track: Track): Promise<void> {
    const hasCurrent = this.queue.current() !== null;
    this.queue.insertNext(track);
    this.emitQueue();
    if (!hasCurrent) {
      await this.playCurrent();
    }
  }

  
  playVariant(track: Track): void {
    if (!this.queue.replaceCurrent(track)) return;
    this.emitQueue();
    void this.playCurrent();
  }

  async play(): Promise<void> {
    if (!this.queue.current()) return;
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

  pause(): void {
    this.adapter.pause();
  }

  async togglePlay(): Promise<void> {
    if (this.state === "playing") {
      this.pause();
    } else {
      await this.play();
    }
  }

  async next(): Promise<void> {
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
        if (more.length > 0) {
          for (const t of more) this.queue.append(t);
          const orderPos = this.queue.positionOf(oldLength);
          if (orderPos >= 0) this.queue.jumpToOrderPos(orderPos);
          await this.playCurrent();
          return;
        }
      } catch {
        
      }
      this.stopAtEnd();
    } else {
      this.stopAtEnd();
    }
  }

  private stopAtEnd(): void {
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

  setCrossfadeMs(ms: number): void {
    this.adapter.setCrossfadeMs(ms);
  }

  setBassBoost(db: number): void {
    this.adapter.setBassBoost(db);
  }

  setReverb(mix: number): void {
    this.adapter.setReverb(mix);
  }

  setStereoWidth(pan: number): void {
    this.adapter.setStereoWidth(pan);
  }

  
  setPauseAfterTrack(on: boolean): void {
    this.pauseAtEnd = on;
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

  addToQueue(track: Track, play = false): void {
    this.queue.append(track);
    if (play) {
      const trackIndex = this.queue.length - 1;
      const pos = this.queue.positionOf(trackIndex);
      if (pos >= 0) this.queue.jumpToOrderPos(pos);
      void this.playCurrent();
    }
    this.emitQueue();
  }

  removeFromQueue(trackIndex: number): void {
    this.queue.removeAt(trackIndex);
    this.emitQueue();
  }

  moveInQueue(fromIndex: number, toIndex: number): void {
    this.queue.move(fromIndex, toIndex);
    this.emitQueue();
  }

  
  updateTrack(id: string, patch: Partial<Track>): void {
    if (this.queue.replaceTrackFields(id, patch)) this.emitQueue();
  }

  clearQueue(): void {
    this.queue.clear();
    this.hasSource = false;
    this.adapter.pause();
    this.setState("idle");
    this.emit("track", null);
    this.emitQueue();
  }

  destroy(): void {
    this.clearStallTimer();
    this.detach.forEach((d) => d());
    this.detach = [];
    this.adapter.destroy();
  }

  private async playCurrent(): Promise<void> {
    const track = this.queue.current();
    if (!track) return;
    if (track.id !== this.fallbackTrackId) {
      this.fallbackUsed = false;
    }
    this.playSeq += 1;
    this.retries = 0;
    this.consecutiveFails = 0;
    await this.startTrack(this.playSeq);
  }

  
  private onLoadError(message: string, seq: number): void {
    if (seq !== this.playSeq || !this.queue.current()) return;
    if (this.state === "paused") return;

    const isMediaError = message.startsWith("audio error code");
    if (isMediaError) {
      const track = this.queue.current();
      if (track && this.invalidateStream) {
        this.invalidateStream(track.id);
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
        void this.playCurrent();
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
    if (!track || seq !== this.playSeq) return;
    this.setState("loading");
    this.startStallTimer();
    this.emit("track", track);
    try {
      const cached = this.preloadCache.get(track.id);
      if (cached) {
        this.preloadCache.delete(track.id);
      }
      
      
      
      
      this.clearStallTimer();
      const uri = cached ?? (this.resolveUri ? await this.resolveUri(track) : track.uri);
      if (seq !== this.playSeq) return;

      await validateStreamUrl(uri);
      await this.adapter.load(uri);
      if (seq !== this.playSeq) return;
      this.hasSource = true;
      this.startStallTimer();
      this.duration = track.duration ?? 0;
      
      
      if (this.restorePosTrackId === track.id && this.restorePos > 0) {
        try {
          this.adapter.seek(this.restorePos);
        } catch {
          
        }
        this.restorePosTrackId = null;
        this.restorePos = 0;
      }
      await this.playWithGuard();
    } catch (err) {
      this.onLoadError(err instanceof Error ? err.message : String(err), seq);
    }
    this.emitQueue();
  }

  

  private async playWithGuard(): Promise<void> {
    let settled = false;
    let timer: number | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = globalThis.setTimeout(() => {
        settled = true;
        resolve();
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
        await this.playCurrent();
      }
    } catch {
      
    }
  }

  
  private async preloadNext(): Promise<void> {
    if (!this.resolveUri) return;
    const next = this.queue.peekNext();
    if (!next || this.preloadedId === next.id) return;
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
    this.emit("queue", {
      queue: this.queue.tracksList,
      index: this.queue.currentIndex(),
      history: this.queue.historyList,
    });
  }
}
