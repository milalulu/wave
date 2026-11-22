import { playbackSource } from "../types";
import { StartupMeasurement, type StartupTiming } from "./StartupMeasurement";
import { EventEmitter } from "../util/EventEmitter";
import type { PlaybackMode, PlayerSnapshot, PlayerState, RepeatMode, Track } from "../types";
import type { AudioAdapter, AudioProcessingState } from "./PlayerAdapter";
import { normalizeEqualizer, sanitizeAudioValue } from "./equalizerPresets";
import { dbToGain, DEFAULT_LEVELING_OPTIONS, desiredGainDb, type NormalizationMode } from "./leveling";
import { Queue } from "../queue/Queue";
import { validateStreamUrl } from "../util/validateUrl";
import { uniqueRecommendations } from "../recordings/matching";

export interface PlayerEvents {
  startup: StartupTiming;
  state: PlayerState;
  track: Track | null;
  /** A successful new play, excluding pause/resume, buffering and source retries. */
  played: Track;
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
  crossfadeMs?: number;

  upgradePreview?: (track: Track) => Promise<Track | null>;
  recoverSource?: (track: Track) => Promise<Track | null>;
  measureLoudness?: (tracks: readonly Track[], signal: AbortSignal) => Promise<number | null>;
}

export class PlayerEngine extends EventEmitter<PlayerEvents> {
  private adapter: AudioAdapter;
  private queue: Queue;
  private state: PlayerState = "idle";
  private volume = 1;
  private speed = 1;
  private equalizer: number[] = [];
  private effectsBypassed = false;
  private levelingEnabled = false;
  private levelingTargetDb = DEFAULT_LEVELING_OPTIONS.targetDb;
  private normalizationMode: NormalizationMode = "adaptive";
  private measuredLevel: number | null = null;
  private measurementKey = "";
  private loudnessAnalysis?: AbortController;
  private readonly measureLoudness?: PlayerEngineOptions["measureLoudness"];
  private bassBoost = 0;
  private reverb = 0;
  private stereoWidth = 0;
  private spatialOrbit = 0;
  private repeat: RepeatMode = "off";
  private mode: PlaybackMode = "normal";
  private crossfadeMs: number | undefined;
  private duration = 0;
  private detach: (() => void)[] = [];
  private prepareTrack: (track: Track) => Track;
  private resolveUri?: (track: Track) => Promise<string>;
  private invalidateStream?: (trackId: string) => void;
   private onQueueEnd?: () => Promise<Track[]> | Track[];
   private defaultFiller?: () => Promise<Track[]> | Track[];
   private upgradePreview?: (track: Track) => Promise<Track | null>;
  private recoverSource?: (track: Track) => Promise<Track | null>;
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
  private keepSelectionOnError = false;
  private static MAX_CONSECUTIVE_FAILS = 5;
  
  private fallback?: () => Track | null;
  private fallbackUsed = false;
  
  private fallbackTrackId: string | null = null;
  
  private pauseAtEnd = false;
  
  private hasSource = false;
  private playRecorded = false;
  private queueUpdateScheduled = false;
  

  private restorePos = 0;
  private restorePosTrackId: string | null = null;
  private lastPlayingPosition = 0;
  private interruptedPosition: number | null = null;
  private waitingForNetwork = false;
  private recoveringSource: number | null = null;
  private alternateAttemptedFor: string | null = null;

  constructor(adapter: AudioAdapter, options: PlayerEngineOptions = {}) {
    super();
    this.adapter = adapter;
    this.prepareTrack = options.prepareTrack ?? ((track) => track);
    this.resolveUri = options.resolveUri;
    this.invalidateStream = options.invalidateStream;
     this.onQueueEnd = options.onQueueEnd;
     this.defaultFiller = options.onQueueEnd;
     this.crossfadeMs = options.crossfadeMs;
     this.upgradePreview = options.upgradePreview;
    this.recoverSource = options.recoverSource;
    this.measureLoudness = options.measureLoudness;
     this.maxRetries = Math.max(0, options.retries ?? 1);
     if (options.autoGenerateThreshold !== undefined) this.autoGenerateThreshold = options.autoGenerateThreshold;
     this.queue = new Queue({ rng: options.rng });
     this.attachAdapter();
  }

  private attachAdapter(): void {
    this.detach.push(
      this.adapter.onStateChange((s) => {
        if (!this.queue.current()) {
          if (s === "playing") this.adapter.pause();
          return;
        }
        if (s === "paused" && this.state === "loading" && this.interruptedPosition !== null) return;
        this.setState(s);
      }),
      this.adapter.onTimeUpdate((position, duration) => {
        if (!this.queue.current()) return;
        if (this.interruptedPosition !== null && this.state !== "playing") return;
        if (this.state === "playing" && position > 0) {
          this.lastPlayingPosition = position;
          this.consecutiveFails = 0;
          this.keepSelectionOnError = false;
        }
        this.duration = duration;
        this.emit("time", { position, duration });
        const remaining = duration - position;
        if (remaining < 30 && remaining > 0) {
          void this.preloadNext();
        }
        void this.maybeUpgradePreview(duration);
      }),
      this.adapter.onEnded(() => this.onTrackEnded()),
      this.adapter.onError((message) => {
        if (this.recoveringSource === this.playSeq) return;
        if (this.interruptedPosition !== null && !this.hasSource) return;
        this.onLoadError(message, this.playSeq);
      }),
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
      mode: this.mode,
      state: this.state,
      current,
      position: current ? this.interruptedPosition ?? (this.restorePosTrackId === current.id ? this.restorePos : this.adapter.getPosition()) : 0,
      duration: current ? current.duration ?? this.duration : 0,
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

  
  async playTracks(tracks: Track[], startIndex = 0, mode: PlaybackMode = "normal", position = 0): Promise<void> {
    if (tracks.length === 0) return;
    this.setMode(mode);
    this.alternateAttemptedFor = null;
    this.queue.replace(tracks.map(this.prepareTrack), startIndex);
    
    this.preloadCache.clear();
    this.preloadedId = null;
    this.fallbackUsed = false;
    this.fallbackTrackId = null;
    this.upgradedTrackId = null;
    
    this.restorePos = Number.isFinite(position) ? Math.max(0, position) : 0;
    this.restorePosTrackId = this.restorePos ? this.queue.current()?.id ?? null : null;
    await this.playCurrent(true, true);
  }

  

  async restoreQueue(queue: Track[], index: number, position = 0, mode: PlaybackMode = "normal"): Promise<void> {
    if (queue.length === 0) return;
    this.setMode(mode);
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
    this.interruptedPosition = null;
    this.waitingForNetwork = false;
    this.lastPlayingPosition = 0;
    this.hasSource = false;
    this.playRecorded = false;
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
      const index = this.queue.tracksList.findIndex((t) => t.id === track.id);
      const pos = this.queue.positionOf(index);
      if (pos >= 0) this.queue.jumpToOrderPos(pos);
      await this.playCurrent();
    }
    return added;
  }

  
  playVariant(track: Track, preservePosition = false): void {
    if (preservePosition) {
      this.restorePos = this.interruptedPosition ?? this.adapter.getPosition();
      this.restorePosTrackId = track.id;
    }
    if (!this.queue.replaceCurrent(track)) return;
    this.interruptedPosition = null;
    this.waitingForNetwork = false;
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
    this.waitingForNetwork = false;
    if (this.state === "ended" && this.mode === "album") {
      this.queue.restart();
      await this.playCurrent(true, true);
      return;
    }
    if (!this.queue.current()) {
      if (!this.queue.length) return;
      this.queue.restart();
      this.hasSource = false;
    }
    if (this.state === "paused") {
      this.setState("loading");
    }
    const seq = this.playSeq;
    try {
      
      
      if (this.interruptedPosition !== null && !this.hasSource) {
        this.retries = 0;
        await this.startTrack(++this.playSeq);
      } else if (this.hasSource) {
        await this.playWithGuard();
      } else {
        await this.playCurrent(true, true);
      }
    } catch (err) {
      
      
      this.onLoadError(err instanceof Error ? err.message : String(err), seq);
    }
  }

  get playbackRevision(): number { return this.playSeq; }

  async resumeAfterReconnect(): Promise<void> {
    if (this.waitingForNetwork && this.state === "paused") await this.play();
  }

  pause(): void {
    this.playSeq += 1;
    this.waitingForNetwork = false;
    if (this.interruptedPosition !== null) this.hasSource = false;
    this.setState("paused");
    this.adapter.pause();
  }

  async togglePlay(): Promise<void> {
    if (this.state === "playing" || (this.state === "loading" && this.interruptedPosition !== null)) {
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
      await this.playCurrent(true, userInitiated);
    } else if (this.repeat === "all" && this.queue.length > 0) {
      this.queue.restart();
      await this.playCurrent(true, userInitiated);
    } else if (this.mode === "normal" && this.onQueueEnd) {
      try {
        const batch = await this.onQueueEnd();
        if (request !== this.playSeq || this.disposed) return;
        const addedMeanwhile = this.queue.next();
        if (addedMeanwhile) {
          await this.playCurrent(true, userInitiated);
          return;
        }
        const oldLength = this.queue.length;
        const more = uniqueRecommendations(batch.map(this.prepareTrack), this.queue.tracksList);
        if (more.length > 0) {
          for (const t of more) this.queue.append(t);
          const orderPos = this.queue.positionOf(oldLength);
          if (orderPos >= 0) this.queue.jumpToOrderPos(orderPos);
          await this.playCurrent(true, userInitiated);
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
    if (this.mode === "album") {
      this.adapter.pause();
      this.hasSource = false;
      this.setState("ended");
      this.emitQueue();
      return;
    }
    this.clearQueue();
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
    this.lastPlayingPosition = seconds;
    if (this.interruptedPosition !== null) this.interruptedPosition = seconds;
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
    this.equalizer = normalizeEqualizer(gains);
    if (!this.effectsBypassed) this.adapter.setEqualizer(this.equalizer);
    this.emit("equalizer", this.equalizer);
  }

  setLeveling(enabled: boolean, targetDb: number, mode: NormalizationMode = "adaptive"): void {
    this.levelingEnabled = enabled;
    this.levelingTargetDb = sanitizeAudioValue(targetDb, -30, -1, DEFAULT_LEVELING_OPTIONS.targetDb);
    this.normalizationMode = mode;
    this.updateLoudnessAnalysis();
  }

  private applyLeveling(): void {
    const active = this.levelingEnabled && !this.effectsBypassed;
    this.adapter.setLeveling(active && this.normalizationMode === "adaptive", this.levelingTargetDb);
    const gain = active && this.measuredLevel !== null
      ? dbToGain(desiredGainDb(this.measuredLevel, { ...DEFAULT_LEVELING_OPTIONS, targetDb: this.levelingTargetDb })) : 1;
    this.adapter.setMeasuredGain?.(gain);
  }

  private updateLoudnessAnalysis(load = true): void {
    const current = this.queue.current();
    const tracks = !current || !this.levelingEnabled || this.normalizationMode === "adaptive" ? []
      : this.normalizationMode === "track" ? [current] : this.mode === "album" ? this.queue.tracksList : [];
    const key = tracks.length ? JSON.stringify([this.normalizationMode, tracks.map((track) => playbackSource(track).id)]) : "";
    if (key !== this.measurementKey) {
      this.loudnessAnalysis?.abort();
      this.loudnessAnalysis = undefined;
      this.measuredLevel = null;
      this.measurementKey = key;
    }
    this.applyLeveling();
    if (!load || !key || this.loudnessAnalysis || !this.measureLoudness || this.disposed) return;
    const controller = this.loudnessAnalysis = new AbortController();
    void this.measureLoudness(tracks, controller.signal).then((level) => {
      if (controller.signal.aborted || this.disposed) return;
      this.measuredLevel = level;
      this.applyLeveling();
      if (level === null) this.loudnessAnalysis = undefined;
    }, () => {
      if (this.loudnessAnalysis === controller) this.loudnessAnalysis = undefined;
    });
  }

  setCrossfadeMs(ms: number): void {
    this.crossfadeMs = ms;
    if (this.mode === "normal") this.adapter.setCrossfadeMs(ms);
  }

  private setMode(mode: PlaybackMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.adapter.setAlbumMode?.(mode === "album");
    if (mode === "album") {
      this.setShuffle(false);
      this.adapter.setCrossfadeMs(0);
    } else if (this.crossfadeMs !== undefined) {
      this.adapter.setCrossfadeMs(this.crossfadeMs);
    }
    this.updateLoudnessAnalysis(false);
  }

  setBassBoost(db: number): void {
    this.bassBoost = sanitizeAudioValue(db, 0, 15);
    if (!this.effectsBypassed) this.adapter.setBassBoost(this.bassBoost);
  }

  setReverb(mix: number): void {
    this.reverb = sanitizeAudioValue(mix, 0, 1);
    if (!this.effectsBypassed) this.adapter.setReverb(this.reverb);
  }

  setStereoWidth(width: number): void {
    this.stereoWidth = sanitizeAudioValue(width, -1, 1);
    if (!this.effectsBypassed) this.adapter.setStereoWidth(this.stereoWidth);
  }

  setSpatialOrbit(amount: number): void {
    this.spatialOrbit = sanitizeAudioValue(amount, 0, 1);
    if (!this.effectsBypassed) this.adapter.setSpatialOrbit?.(this.spatialOrbit);
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
    this.updateAlbumPreload();
  }

  setEffectsBypassed(bypassed: boolean): void {
    this.effectsBypassed = bypassed;
    this.applyAudioSettings();
  }

  private applyAudioSettings(): void {
    this.adapter.setEqualizer(this.effectsBypassed ? [] : this.equalizer);
    this.adapter.setBassBoost(this.effectsBypassed ? 0 : this.bassBoost);
    this.adapter.setReverb(this.effectsBypassed ? 0 : this.reverb);
    this.adapter.setStereoWidth(this.effectsBypassed ? 0 : this.stereoWidth);
    this.adapter.setSpatialOrbit?.(this.effectsBypassed ? 0 : this.spatialOrbit);
    this.applyLeveling();
  }

  
  getPlaybackPosition(): number | undefined {
    if (!this.hasSource || this.disposed) return undefined;
    const position = this.adapter.getPosition();
    return Number.isFinite(position) ? position : undefined;
  }

  getLimiterReduction(): number | undefined {
    return this.adapter.getLimiterReduction?.();
  }

  getAudioProcessingState(): AudioProcessingState {
    return this.adapter.getAudioProcessingState?.() ?? "standby";
  }

  getSpectrum(data: Uint8Array): void {
    this.adapter.getSpectrum(data);
  }

  setShuffle(on: boolean): void {
    if (on && this.mode === "album") this.setMode("normal");
    this.queue.setShuffle(on);
    this.emit("shuffle", on);
    this.emitQueue();
  }

  setRepeat(mode: RepeatMode): void {
    this.repeat = mode;
    this.updateAlbumPreload();
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
      const trackIndex = this.queue.tracksList.findIndex((t) => t.id === track.id);
      const pos = this.queue.positionOf(trackIndex);
      if (pos >= 0) this.queue.jumpToOrderPos(pos);
      void this.playCurrent();
    }
    this.emitQueue();
    void this.prefetchBatch();
    return added;
  }

  async playQueueIndex(trackIndex: number): Promise<void> {
    const position = this.queue.positionOf(trackIndex);
    if (position < 0) return;
    this.queue.jumpToOrderPos(position);
    await this.playCurrent(true, true);
  }

  removeFromQueue(trackIndex: number): void {
    const removingCurrent = trackIndex === this.queue.currentIndex();
    const wasActive = this.state === "playing" || this.state === "loading";
    if (!this.queue.removeAt(trackIndex)) return;
    if (removingCurrent) {
      if (!this.queue.current()) {
        this.clearQueue();
        return;
      }
      this.playSeq += 1;
      this.clearStallTimer();
      this.hasSource = false;
      this.playRecorded = false;
      this.restorePos = 0;
      this.restorePosTrackId = null;
      this.adapter.pause();
      this.adapter.seek(0);
      const track = this.queue.current()!;
      this.duration = playbackSource(track).duration ?? track.duration ?? 0;
      this.emit("track", track);
      this.emit("time", { position: 0, duration: this.duration });
      if (wasActive) void this.playCurrent();
      else this.setState("paused");
    }
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
    this.duration = 0;
    this.restorePos = 0;
    this.restorePosTrackId = null;
    this.interruptedPosition = null;
    this.waitingForNetwork = false;
    this.lastPlayingPosition = 0;
    this.setState("idle");
    this.emit("time", { position: 0, duration: 0 });
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
    this.loudnessAnalysis?.abort();
    this.playSeq += 1;
    this.clearStallTimer();
    this.detach.forEach((d) => d());
    this.detach = [];
    this.adapter.destroy();
    this.clear();
  }

  private async playCurrent(usePreference = true, keepSelectionOnError = false): Promise<void> {
    const selected = this.queue.current();
    if (!selected) return;
    this.alternateAttemptedFor = null;
    this.preloadedId = null;
    this.interruptedPosition = null;
    this.waitingForNetwork = false;
    this.lastPlayingPosition = 0;
    if (usePreference) this.playRecorded = false;
    this.keepSelectionOnError = keepSelectionOnError;
    if (keepSelectionOnError) this.consecutiveFails = 0;
    const track = usePreference ? this.prepareTrack(selected) : selected;
    if (track !== selected) this.queue.replaceCurrent(track);
    if (track.id !== this.fallbackTrackId) {
      this.fallbackUsed = false;
    }
    this.playSeq += 1;
    this.hasSource = false;
    this.retries = 0;
    void this.maybeRefillQueue();
    await this.startTrack(this.playSeq);
    void this.preloadNext();
  }

  
  private onLoadError(message: string, seq: number): void {
    if (seq !== this.playSeq || !this.queue.current()) return;
    if (this.state === "paused") return;

    const isMediaError = message.startsWith("audio error code");
    const isStreamError = /network error|audio decode error|stream stalled|HLS stream error|stream URL returned|\b403\b/i.test(message);
    if (this.resolveUri && this.hasSource && this.playRecorded && (isMediaError || isStreamError)) {
      this.interruptedPosition ??= this.adapter.getPosition() || this.lastPlayingPosition;
      this.hasSource = false;
    }
    if (isMediaError || isStreamError) {
      const track = this.queue.current();
      if (track && this.invalidateStream) {
        this.invalidateStream(playbackSource(track).id);
      }
    }

    if (this.resolveUri && this.retries < this.maxRetries) {
      this.retries += 1;
      void this.startTrack(++this.playSeq);
      return;
    }

    const selected = this.queue.current();
    if (this.recoverSource && selected && this.alternateAttemptedFor !== selected.id
      && (typeof navigator === "undefined" || navigator.onLine !== false)) {
      this.alternateAttemptedFor = selected.id;
      const recovery = ++this.playSeq;
      this.recoveringSource = recovery;
      this.clearStallTimer();
      void this.recoverSource(selected).catch(() => null).then((alternative) => {
        if (this.recoveringSource === recovery) this.recoveringSource = null;
        if (recovery !== this.playSeq || this.disposed) return;
        if (!alternative || !this.queue.replaceCurrent(alternative)) {
          this.onLoadError(message, recovery);
          return;
        }
        this.retries = 0;
        this.hasSource = false;
        void this.startTrack(recovery);
      });
      return;
    }

    if (this.interruptedPosition !== null) {
      this.hasSource = false;
      this.pause();
      this.waitingForNetwork = typeof navigator !== "undefined" && navigator.onLine === false;
      this.emit("error", this.waitingForNetwork ? "Network disconnected. Playback position was saved." : message);
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
        void this.playCurrent(false, this.keepSelectionOnError);
        return;
      }
    }
    this.fallbackUsed = false;
    this.clearStallTimer();
    this.emit("error", message);
    if (this.keepSelectionOnError) {
      this.hasSource = false;
      this.consecutiveFails = 0;
      this.pause();
      return;
    }
    void this.next();
  }

  private async startTrack(seq: number): Promise<void> {
    const track = this.queue.current();
    if (this.disposed || !track || seq !== this.playSeq) return;
    this.setState("loading");
    this.updateLoudnessAnalysis(false);
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
      
      
      const restoring = this.restorePosTrackId === track.id;
      const resumeAt = this.interruptedPosition ?? (restoring ? this.restorePos : 0);
      if (resumeAt > 0) {
        try {
          this.adapter.seek(resumeAt);
        } catch {
          
        }
      }
      await timing.measure("play", () => this.playWithGuard());
      if (seq === this.playSeq) {
        if (restoring) {
          this.restorePosTrackId = null;
          this.restorePos = 0;
        }
        this.interruptedPosition = null;
        outcome = "playing";
        this.updateLoudnessAnalysis();
      }
    } catch (err) {
      if (seq === this.playSeq) outcome = "failed";
      this.onLoadError(err instanceof Error ? err.message : String(err), seq);
    } finally {
      this.emit("startup", timing.finish(outcome));
    }
    this.emitQueue();
  }

  

  private async playWithGuard(): Promise<void> {
    const seq = this.playSeq;
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
        if (!settled && seq === this.playSeq && !this.disposed && !this.playRecorded) {
          const track = this.queue.current();
          if (track) {
            this.playRecorded = true;
            this.emit("played", track);
          }
        }
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
    if (this.mode === "album" && (this.pauseAtEnd || this.repeat === "one")) return;
    const queued = this.queue.peekNext();
    const next = queued ? this.prepareTrack(queued) : null;
    if (!next || this.preloadedId === next.id) return;
    const seq = this.playSeq;
    if (next.uri) {
      this.preloadedId = next.id;
      try {
        const uri = await this.preloadCache.get(next.id) || await this.resolveUri(next);
        if (seq === this.playSeq && this.preloadedId === next.id && next.id === this.queue.peekNext()?.id) {
          this.preloadCache.set(next.id, uri);
          this.adapter.preload(uri);
        }
      } catch {
        if (seq === this.playSeq && this.preloadedId === next.id) this.preloadedId = null;
      }
    }
  }

  private updateAlbumPreload(): void {
    if (this.mode !== "album") return;
    const next = this.pauseAtEnd || this.repeat === "one" ? null : this.queue.peekNext();
    if (this.preloadedId !== (next?.id ?? null)) {
      this.preloadedId = null;
      this.adapter.cancelPreload?.();
      if (next && this.state === "playing") void this.preloadNext();
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
    if (this.mode === "album") return;
    const remaining = this.queue.remainingCount();
    if (remaining >= this.autoGenerateThreshold) return;
    if (!this.onQueueEnd) return;
    void this.refillQueue();
  }

  private async refillQueue(): Promise<void> {
    const seq = this.playSeq;
    try {
      const batch = await this.onQueueEnd!();
      if (seq !== this.playSeq || this.disposed || this.mode === "album") return;
      const more = uniqueRecommendations(batch.map(this.prepareTrack), this.queue.tracksList);
      if (more.length > 0) {
        for (const t of more) this.queue.append(t);
        this.emitQueue();
        void this.preloadNext();
      }
    } catch (err) {
      this.emit("error", `auto-fill failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async onTrackEnded(): Promise<void> {
    if (!this.queue.current() || this.disposed || this.interruptedPosition !== null) return;
    this.playRecorded = false;
    
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
      this.updateAlbumPreload();
      this.emit("queue", {
        queue: this.queue.tracksList,
        index: this.queue.currentIndex(),
        history: this.queue.historyList,
      });
    });
  }
}
