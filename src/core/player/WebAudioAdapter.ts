import { fetchMediaBlob, MEDIA_MEMORY_TIMEOUT_MS } from "./mediaMemoryFallback";
import { isLocalMediaUri } from "../util/localMedia";
import type { PlayerState } from "../types";
import type { AudioAdapter } from "./PlayerAdapter";
import type Hls from "hls.js";
import type { LoaderCallbacks, LoaderConfiguration, LoaderContext } from "hls.js";
import { DEFAULT_LEVELING_OPTIONS, Leveler } from "./leveling";
import { AudioProcessing, GAIN_TAU } from "./audioProcessing";
import { normalizeEqualizer, sanitizeAudioValue } from "./equalizerPresets";

export { EQ_FREQUENCIES } from "./equalizerPresets";

export const CROSSFADE_MS = 300;

export { GAIN_TAU } from "./audioProcessing";

export const PROXY_BASE = "http://127.0.0.1:8299";

function isBufferedAlbumSource(uri: string): boolean {
  return isLocalMediaUri(uri) || uri.startsWith("blob:");
}

export function isProxiedAudioUrl(src: string | null | undefined): boolean {
  return Boolean(src && src.startsWith(PROXY_BASE));
}

function isHlsUrl(src: string | null): boolean {
  return src !== null && /\.m3u8(?:[?#]|$)/i.test(src);
}

export const MEDIA_ELEMENT_PROBE_MS = 1500;

export const MEDIA_ELEMENT_READY_PROBE_MS = 8000;

export const BUFFER_TIME_UPDATE_MS = 250;

export const BUFFER_CACHE_MAX = 4;
const BUFFER_CACHE_MAX_BYTES = 64 * 1024 * 1024;
const pcmBytes = (audio: AudioBuffer): number => audio.length * audio.numberOfChannels * Float32Array.BYTES_PER_ELEMENT;

export const LEVEL_TICK_MS = 120;

export function isWebKitEngine(ua = typeof navigator === "undefined" ? "" : navigator.userAgent): boolean {
  return /AppleWebKit\//.test(ua) && !/Chrome\/|Chromium\/|Edg\//.test(ua);
}

// За сколько секунд до конца трека подхватывать предзагруженный буфер,
// чтобы склейка прошла точно по часам контекста (настоящий gapless).
export const CHAIN_LOOKAHEAD_SEC = 0.3;

type StateCb = (state: PlayerState) => void;
type TimeCb = (position: number, duration: number) => void;
type ElementMode = "element" | "buffer";

export class WebAudioAdapter implements AudioAdapter {
  
  private elements: (HTMLAudioElement | null)[] = [null, null];
  private activeIdx = 0;
  private ctx: AudioContext | null = null;
  private fadeGains: GainNode[] = [];
  private processing: AudioProcessing | null = null;
  private graphDisabled = false;
  private bypassedStream: string | null = null;
  private directRecovery: Promise<void> | null = null;

  
  private bassBoostGain = 0;
  private reverbMix = 0;
  private stereoWidth = 0;
  private spatialOrbit = 0;

  private leveler = new Leveler();
  private levelingEnabled = false;
  private measuredGain = 1;
  private levelTargetDb = DEFAULT_LEVELING_OPTIONS.targetDb;
  private levelTimer: ReturnType<typeof globalThis.setInterval> | undefined;
  private levelSmoothDb = -Infinity;

  private gains: number[] = [];

  private pendingUri: string | null = null;
  private hls: Hls | null = null;
  private hlsLoad: AbortController | null = null;
  private preloadedUri: string | null = null;
  private pendingSeek: number | null = null;
  private fading = false;
  private fadeTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
  private masterVolume = 1;
  private processingPaused = false;
  private playbackRate = 1;

  
  private mode: ElementMode = "element";
  private albumMode = false;
  private albumBuffer = false;
  private probed = false;
  private elementProxyRetried = false;
  private probeTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
  private readyProbeTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
  private pendingElementSrc: string | null = null;
  
  private playRequested = false;
  private fadeRevision = 0;
  private elementPlayPending = false;
  private memoryRecovery: Promise<void> | null = null;
  private memoryController: AbortController | null = null;
  private memoryObjectUrl: string | null = null;

  
  private bufCtx: AudioContext | null = null;
  private bufSrcGains: (GainNode | null)[] = [null, null];
  private bufferProcessing: AudioProcessing | null = null;
  private buf: AudioBuffer | null = null;
  private bufUri: string | null = null;
  private bufDecoding: Promise<void> | null = null;
  private bufLoading = false;
  private bufNext: AudioBuffer | null = null;

  
  private bufNextUri: string | null = null;
  private bufSource: AudioBufferSourceNode | null = null;
  private bufSourceGainIdx = 0;
  private bufBaseOffset = 0;
  private bufSourceCtxStart = 0;
  private bufPosition = 0;
  private bufPlaying = false;
  private bufRate = 1;
  private bufPendingSeek: number | null = null;
  private timeTimer: ReturnType<typeof globalThis.setInterval> | undefined;
  private bufChainTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
  private proxiedHosts = new Set<string>();
  
  private bufferCache = new Map<string, AudioBuffer>();

  private stateCb: StateCb | null = null;
  private timeCb: TimeCb | null = null;
  private endedCb: (() => void) | null = null;
  private errorCb: ((message: string) => void) | null = null;

  private crossfadeMs: number;

  constructor(crossfadeMs: number = CROSSFADE_MS) {
    this.crossfadeMs = crossfadeMs;
  }

  setCrossfadeMs(ms: number): void {
    this.crossfadeMs = Math.max(0, Math.round(ms));
  }

  private activeElement(): HTMLAudioElement {
    return this.elements[this.activeIdx] ?? this.ensureElements()[this.activeIdx]!;
  }

  private inactiveElement(): HTMLAudioElement | null {
    return this.elements[1 - this.activeIdx];
  }

  private ensureElements(): (HTMLAudioElement | null)[] {
    if (this.elements[0] && this.elements[1]) return this.elements;
    for (let i = 0; i < 2; i++) {
      if (!this.elements[i]) {
        const el = new Audio();
        el.preload = "auto";
        
        
        el.crossOrigin = "anonymous";
        el.volume = this.masterVolume;
        el.playbackRate = this.playbackRate;
        this.attachHandlers(el);
        this.elements[i] = el;
      }
    }
    return this.elements;
  }

  private attachHandlers(el: HTMLAudioElement): void {
    const isActive = (): boolean => el === this.activeElement();
    el.onplay = (): void => {
      if (isActive()) this.stateCb?.("playing");
    };
    el.onpause = (): void => {
      if (isActive() && el.paused) this.stateCb?.("paused");
    };
    el.onwaiting = (): void => {
      if (isActive()) this.stateCb?.("loading");
    };
    el.onplaying = (): void => {
      if (isActive()) this.stateCb?.("playing");
    };
    el.onended = (): void => {
      if (!isActive()) return;
      this.stateCb?.("ended");
      this.endedCb?.();
    };
    el.onerror = (): void => {
      if (isActive() && this.isMediaCacheFailure(el)) {
        // play() observes the same error; let it await recovery rather than retrying
        // the provider while a usable stream is already available.
        if (!this.elementPlayPending && this.playRequested) {
          const recovery = this.recoverMediaCache(el);
          void recovery.catch((error: unknown) => {
            if (this.playRequested && this.memoryRecovery === recovery) this.errorCb?.(String(error));
          });
        }
        return;
      }
      
      
      
      if (isActive() && !this.hls && !isProxiedAudioUrl(this.pendingElementSrc)
          && !this.graphDisabled && this.ctx && el.crossOrigin) {
        const src = el.currentSrc || el.src;
        const position = this.pendingSeek ?? el.currentTime;
        const shouldResume = this.playRequested;
        this.bypassedStream = this.pendingElementSrc;
        this.cancelFade();
        this.teardownGraph();
        this.graphDisabled = true;
        for (const previous of this.elements) if (previous) {
          previous.onpause = null;
          previous.pause();
        }
        this.elements = [null, null];
        this.ensureElements();
        const next = this.activeElement();
        next.crossOrigin = null;
        if (src) {
          this.pendingSeek = position;
          next.src = src;
          next.load();
          if (shouldResume) {
            const recovery = next.play();
            this.directRecovery = recovery;
            void recovery.catch((error: unknown) => {
              if (!this.elementPlayPending && this.playRequested && this.directRecovery === recovery) this.errorCb?.(String(error));
            });
          }
        }
        return;
      }
      if (isActive()) {
        const code = el.error?.code ?? 0;
        const msg =
          code === 1
            ? "playback aborted"
            : code === 2
              ? "network error — stream may have expired, retrying"
              : code === 3
                ? "audio decode error — format may be unsupported"
                : "stream rejected — try setting WAVE_YTDLP_COOKIES=browser:chrome";
        this.errorCb?.(msg);
      }
    };
    el.ontimeupdate = (): void => {
      if (isActive()) this.emitTime();
    };
    el.onloadedmetadata = (): void => {
      if (!isActive()) return;
      this.applySeek();
      this.emitTime();
    };
    el.ondurationchange = (): void => {
      if (isActive()) this.emitTime();
    };
  }

  private isMediaCacheFailure(el: HTMLAudioElement): boolean {
    const src = el.currentSrc || el.src;
    return isWebKitEngine() && !src.startsWith("blob:")
      && (/could not create temp file.*WebKit-Media/i.test(el.error?.message ?? "")
        // WebKitGTK can fetch Tauri assets but reject that scheme as a media source.
        || (el.error?.code === 4 && isLocalMediaUri(src)));
  }

  private cancelMemoryRecovery(release: boolean): void {
    this.memoryController?.abort();
    this.memoryController = null;
    this.memoryRecovery = null;
    if (release && this.memoryObjectUrl) {
      URL.revokeObjectURL(this.memoryObjectUrl);
      this.memoryObjectUrl = null;
    }
  }

  private recoverMediaCache(el: HTMLAudioElement): Promise<void> {
    if (this.memoryRecovery) return this.memoryRecovery;
    const src = el.currentSrc || el.src;
    const url = /^https?:/.test(src) && !isProxiedAudioUrl(src) && !isLocalMediaUri(src)
      ? `${PROXY_BASE}/audio?url=${encodeURIComponent(src)}` : src;
    const controller = new AbortController();
    this.memoryController = controller;
    const timer = globalThis.setTimeout(() => controller.abort(), MEDIA_MEMORY_TIMEOUT_MS);
    const position = el.currentTime;
    this.memoryRecovery = (async () => {
      try {
        const blob = await fetchMediaBlob(url, controller.signal);
        controller.signal.throwIfAborted();
        if (!this.playRequested || el !== this.activeElement()) return;
        if (this.memoryObjectUrl) URL.revokeObjectURL(this.memoryObjectUrl);
        this.memoryObjectUrl = URL.createObjectURL(blob);
        // WebKit uses memory buffering for blob: media, avoiding its unwritable
        // /var/tmp download cache while retaining streamed audio decoding and EQ.
        this.pendingElementSrc = this.memoryObjectUrl;
        el.src = this.memoryObjectUrl;
        this.pendingSeek = position || this.pendingSeek;
        el.load();
        await el.play();
      } finally {
        globalThis.clearTimeout(timer);
      }
    })();
    return this.memoryRecovery;
  }

  private emitTime(): void {
    if (!this.timeCb) return;
    if (this.mode === "buffer") {
      this.timeCb(this.bufGetPosition(), this.buf?.duration ?? 0);
      return;
    }
    const el = this.activeElement();
    if (!el) return;
    const duration = Number.isFinite(el.duration) ? el.duration : 0;
    this.timeCb(el.currentTime, duration);
  }

  private applySeek(): void {
    const el = this.activeElement();
    if (!el || this.pendingSeek === null || !Number.isFinite(el.duration)) return;
    try {
      el.currentTime = Math.min(this.pendingSeek, Math.max(el.duration, 0));
      this.pendingSeek = null;
    } catch {
      
      
    }
  }

  private audioCtor(): typeof AudioContext | null {
    return (
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ??
      null
    );
  }

  

  private ensureGraph(): void {
    this.ensureElements();
    if (this.ctx || this.graphDisabled) return;
    const Ctor = this.audioCtor();
    if (!Ctor) {
      this.graphDisabled = true;
      return;
    }
    try {
      const ctx = new Ctor();
      this.ctx = ctx;
      const src0 = ctx.createMediaElementSource(this.elements[0]!);
      const src1 = ctx.createMediaElementSource(this.elements[1]!);
      const g0 = ctx.createGain();
      const g1 = ctx.createGain();
      g0.gain.value = this.activeIdx === 0 ? 1 : 0;
      g1.gain.value = this.activeIdx === 1 ? 1 : 0;
      this.processing = new AudioProcessing(ctx, this.processingSettings());
      src0.connect(g0);
      src1.connect(g1);
      g0.connect(this.processing.input);
      g1.connect(this.processing.input);
      this.fadeGains = [g0, g1];
      for (const el of this.elements) if (el) el.volume = 1;
    } catch {
      this.teardownGraph();
      this.graphDisabled = true;
      this.elements = [null, null];
      this.ensureElements();
    }
  }

  private teardownGraph(): void {
    if (this.ctx) {
      void this.ctx.close().catch(() => undefined);
    }
    this.stopLevelTimer();
    this.ctx = null;
    this.fadeGains = [];
    this.processing = null;
  }

  private processingSettings() {
    return {
      gains: this.gains, bass: this.bassBoostGain, reverb: this.reverbMix,
      width: this.stereoWidth, orbit: this.spatialOrbit, volume: this.processingPaused ? 0 : this.masterVolume,
    };
  }

  private get activeProcessing(): AudioProcessing | null {
    return this.mode === "buffer" ? this.bufferProcessing : this.processing;
  }

  private updateProcessing(): void {
    const settings = this.processingSettings();
    this.processing?.update(settings);
    this.bufferProcessing?.update(settings);
  }

  private resumeCtx(): void {
    if (this.ctx?.state === "suspended") {
      void this.ctx.resume().catch(() => undefined);
    }
  }

  private rebalanceGains(): void {
    if (!this.ctx || this.fadeGains.length !== 2) return;
    const t = this.ctx.currentTime;
    this.fadeGains[this.activeIdx].gain.setTargetAtTime(1, t, GAIN_TAU);
    this.fadeGains[1 - this.activeIdx].gain.setTargetAtTime(0, t, GAIN_TAU);
  }

  private cancelFade(): void {
    this.fadeRevision += 1;
    this.inactiveElement()?.pause();
    if (this.fadeTimer !== undefined) {
      globalThis.clearTimeout(this.fadeTimer);
      this.fadeTimer = undefined;
    }
    this.fading = false;
  }

  private swapActive(): void {
    this.activeIdx = 1 - this.activeIdx;
    this.preloadedUri = null;
  }

  
  private finishFade(): void {
    if (this.fadeTimer !== undefined) {
      globalThis.clearTimeout(this.fadeTimer);
      this.fadeTimer = undefined;
    }
    if (!this.fading) return;
    this.fading = false;
    const prev = this.elements[this.activeIdx];
    this.swapActive();
    prev?.pause();
    this.stateCb?.("playing");
    this.emitTime();
  }

  private async startCrossfade(uri: string): Promise<void> {
    const prev = this.activeElement();
    const next = this.inactiveElement();
    if (!next || !this.ctx || !prev) throw new Error("crossfade unavailable");
    this.cancelFade();
    const revision = this.fadeRevision;
    if (next.currentSrc !== uri) {
      next.src = uri;
      next.load();
    }
    next.volume = this.processing ? 1 : this.masterVolume;
    next.playbackRate = this.playbackRate;
    const prevGain = this.fadeGains[this.activeIdx];
    const nextGain = this.fadeGains[1 - this.activeIdx];
    const t = this.ctx.currentTime;
    if (this.crossfadeMs === 0) {
      // Gapless hard swap: мгновенная перекидка гейнов без лишних таймеров.
      prevGain.gain.cancelScheduledValues(t);
      prevGain.gain.setValueAtTime(0, t);
      nextGain.gain.cancelScheduledValues(t);
      nextGain.gain.setValueAtTime(1, t);
    } else {
      prevGain.gain.setTargetAtTime(0, t, GAIN_TAU);
      nextGain.gain.setTargetAtTime(1, t, GAIN_TAU);
    }
    this.fading = true;
    const playP = next.play();
    if (this.crossfadeMs === 0) {
      // Зависший play() нового трека не должен держать старый играющим.
      this.finishFade();
    }
    try {
      await playP;
    } catch (err) {
      this.finishFade();
      throw err;
    }
    if (revision !== this.fadeRevision || !this.playRequested) return;
    if (this.crossfadeMs !== 0 && this.fading) {
      this.fadeTimer = globalThis.setTimeout(() => this.finishFade(), this.crossfadeMs + 60);
    }
  }

  

  async load(src: string): Promise<void> {
    this.cancelMemoryRecovery(true);
    this.directRecovery = null;
    this.clearBufChain();
    this.pendingUri = null;
    const hlsSource = isHlsUrl(src);
    this.releaseHls();
    if (this.bypassedStream !== null && this.bypassedStream !== src) {
      this.cancelFade();
      for (const element of this.elements) element?.pause();
      this.elements = [null, null];
      this.graphDisabled = false;
      this.bypassedStream = null;
    }
    const bufferAlbum = this.albumMode && isBufferedAlbumSource(src);
    if (bufferAlbum && this.mode === "element") {
      this.switchToBufferMode();
      this.albumBuffer = this.bufCtx !== null;
    }
    if (hlsSource || isProxiedAudioUrl(src) || (!bufferAlbum && (this.albumMode || this.albumBuffer))) {
      this.switchToElementMode();
      this.albumBuffer = false;
    }
    if (this.mode === "buffer") {
      try {
        await this.bufLoad(src);
        return;
      } catch (error) {
        if (!bufferAlbum) throw error;
        this.switchToElementMode();
        this.albumBuffer = false;
      }
    }
    if (this.levelingEnabled) this.resetLevelingGain();
    this.playRequested = false;
    this.pendingElementSrc = src;
    this.ensureGraph();
    this.cancelFade();
    const active = this.activeElement();
    this.pendingSeek = null;
    if (hlsSource) {
      active.pause();
      active.removeAttribute("src");
      active.load();
      this.preloadedUri = null;
      this.rebalanceGains();
      await this.loadHls(src, active);
      return;
    }
    const playing = !active.paused && !active.ended;
    if (playing && this.ctx) {
      this.pendingUri = src;
      this.scheduleProbe();
      return;
    }
    const next = this.inactiveElement();
    if (next && next.currentSrc === src) {
      this.swapActive();
      next.currentTime = 0;
      this.rebalanceGains();
      this.scheduleProbe();
      return;
    }
    active.src = src;
    this.elementProxyRetried = false;
    active.load();
    this.preloadedUri = null;
    this.scheduleProbe();
  }

  
  preload(src: string): void {
    if (isHlsUrl(src)) return;
    if (this.mode === "buffer") {
      if (this.albumMode && !isBufferedAlbumSource(src)) return;
      // Преддекодируем следующий трек заранее: без этого gapless-чейн
      // не получит готовый буфер к концу текущего.
      this.bufPreload(src);
      return;
    }
    const active = this.activeElement();
    const next = this.inactiveElement();
    if (!active.currentSrc || !next) return;
    
    
    if (!next.paused) return;
    if (this.preloadedUri === src) return;
    this.preloadedUri = src;
    next.volume = this.processing ? 1 : this.masterVolume;
    next.playbackRate = this.playbackRate;
    next.src = src;
    next.load();
  }

  setAlbumMode(enabled: boolean): void {
    const previous = this.albumMode;
    this.albumMode = enabled;
    if (previous && !enabled) this.cancelPreload();
  }

  cancelPreload(): void {
    this.clearBufChain();
    this.bufNext = null;
    this.bufNextUri = null;
  }

  private releaseHls(): void {
    this.hlsLoad?.abort();
    this.hlsLoad = null;
    this.hls?.destroy();
    this.hls = null;
  }

  private async loadHls(src: string, element: HTMLAudioElement): Promise<void> {
    const controller = new AbortController();
    this.hlsLoad = controller;
    try {
      const { default: Hls } = await import("hls.js");
      controller.signal.throwIfAborted();
      if (!Hls.isSupported()) {
        if (!element.canPlayType("application/vnd.apple.mpegurl")) throw new Error("HLS playback is unavailable");
        element.src = src;
        element.load();
        return;
      }
      // Keep the CDN URL as the base for relative segment URIs while the
      // native media route makes the actual requests with the app's networking.
      const BaseLoader = Hls.DefaultConfig.loader;
      class MediaLoader extends BaseLoader {
        override load(context: LoaderContext, config: LoaderConfiguration, callbacks: LoaderCallbacks<LoaderContext>): void {
          const original = context.url;
          super.load({ ...context, url: `${PROXY_BASE}/audio?url=${encodeURIComponent(original)}` }, config, {
            ...callbacks,
            onSuccess: (response, stats, _context, details) => {
              callbacks.onSuccess({ ...response, url: original }, stats, context, details);
            },
            onError: (error, _context, details, stats) => callbacks.onError(error, context, details, stats),
            onTimeout: (stats, _context, details) => callbacks.onTimeout(stats, context, details),
            onAbort: (stats, _context, details) => callbacks.onAbort?.(stats, context, details),
            onProgress: callbacks.onProgress &&
              ((stats, _context, data, details) => callbacks.onProgress?.(stats, context, data, details)),
          });
        }
      }
      const hls = new Hls({ enableWorker: false, maxBufferLength: 30, loader: MediaLoader });
      this.hls = hls;
      await new Promise<void>((resolve, reject) => {
        let started = false;
        const timer = globalThis.setTimeout(() => fail(new Error("HLS manifest timed out")), 8000);
        const abort = () => fail(controller.signal.reason);
        controller.signal.addEventListener("abort", abort, { once: true });
        const cleanup = () => {
          globalThis.clearTimeout(timer);
          controller.signal.removeEventListener("abort", abort);
        };
        const fail = (error: unknown) => {
          cleanup();
          reject(error);
        };
        hls.once(Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(src));
        hls.once(Hls.Events.MANIFEST_PARSED, () => {
          started = true;
          cleanup();
          resolve();
        });
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal || controller.signal.aborted) return;
          const code = data.response?.code;
          const message = `HLS stream error: ${data.details}${code ? ` (HTTP ${code})` : ""}`;
          cleanup();
          if (started) this.errorCb?.(message);
          else reject(new Error(message));
        });
        hls.attachMedia(element);
      });
    } catch (error) {
      if (this.hlsLoad === controller) this.releaseHls();
      throw error;
    }
  }

  
  setEqualizer(gains: number[]): void {
    this.gains = normalizeEqualizer(gains);
    this.updateProcessing();
  }

  setBassBoost(db: number): void {
    this.bassBoostGain = sanitizeAudioValue(db, 0, 15);
    this.updateProcessing();
  }

  setReverb(mix: number): void {
    this.reverbMix = sanitizeAudioValue(mix, 0, 1);
    this.updateProcessing();
  }

  setStereoWidth(width: number): void {
    this.stereoWidth = sanitizeAudioValue(width, -1, 1);
    this.updateProcessing();
  }

  setSpatialOrbit(amount: number): void {
    this.spatialOrbit = sanitizeAudioValue(amount, 0, 1);
    this.updateProcessing();
  }

  setLeveling(enabled: boolean, targetDb: number): void {
    const target = sanitizeAudioValue(targetDb, -30, -1, DEFAULT_LEVELING_OPTIONS.targetDb);
    if (enabled === this.levelingEnabled && target === this.levelTargetDb) return;
    this.levelingEnabled = enabled;
    this.levelTargetDb = target;
    this.leveler = new Leveler({ ...DEFAULT_LEVELING_OPTIONS, targetDb: target });
    this.levelSmoothDb = -Infinity;
    if (!enabled) {
      this.stopLevelTimer();
      this.resetLevelingGain();
    } else if (this.playRequested || this.bufPlaying) {
      this.startLevelTimer();
    }
  }

  private resetLevelingGain(): void {
    this.leveler.reset();
    this.levelSmoothDb = -Infinity;
    this.applyMeasuredGain();
  }

  setMeasuredGain(gain: number): void {
    this.measuredGain = gain;
    if (!this.levelingEnabled) this.applyMeasuredGain();
  }

  private applyMeasuredGain(): void {
    if (this.processing && this.ctx) this.processing.level.gain.setTargetAtTime(this.measuredGain, this.ctx.currentTime, .16);
    if (this.bufferProcessing && this.bufCtx) this.bufferProcessing.level.gain.setTargetAtTime(this.measuredGain, this.bufCtx.currentTime, .16);
  }

  private startLevelTimer(): void {
    if (this.levelTimer !== undefined) return;
    this.levelTimer = globalThis.setInterval(() => this.tickLeveling(), LEVEL_TICK_MS);
  }

  private stopLevelTimer(): void {
    if (this.levelTimer !== undefined) {
      globalThis.clearInterval(this.levelTimer);
      this.levelTimer = undefined;
    }
  }

  private tickLeveling(): void {
    if (!this.levelingEnabled) return;
    const inBuffer = this.mode === "buffer";
    const processing = this.activeProcessing;
    const ctx = inBuffer ? this.bufCtx : this.ctx;
    if (!processing || !ctx || ctx.state !== "running") return;
    if (inBuffer ? !this.bufPlaying : !this.playRequested) return;
    try {
      const db = processing.inputLevelDb();
      if (db <= DEFAULT_LEVELING_OPTIONS.silenceDb || !Number.isFinite(db)) return;
      const dt = LEVEL_TICK_MS / 1000;
      this.levelSmoothDb = Number.isFinite(this.levelSmoothDb)
        ? this.levelSmoothDb + (db - this.levelSmoothDb) * Math.min(1, dt / 0.4)
        : db;
      const gain = this.leveler.step(this.levelSmoothDb, dt);
      processing.level.gain.setTargetAtTime(gain, ctx.currentTime, 0.1);
    } catch {}
  }

  async play(): Promise<void> {
    this.playRequested = true;
    this.processingPaused = false;
    this.activeProcessing?.setVolume(this.masterVolume);
    if (this.levelingEnabled && this.activeProcessing) this.startLevelTimer();
    if (this.mode === "buffer") {
      await this.bufPlay();
      return;
    }
    this.resumeCtx();
    const pending = this.pendingUri;
    this.pendingUri = null;
    this.elementPlayPending = true;
    try {
      if (pending !== null && this.ctx) await this.startCrossfade(pending);
      else await this.activeElement().play();
      if (this.directRecovery) await this.directRecovery;
    } catch (error) {
      if (this.directRecovery) return this.directRecovery;
      if (!this.playRequested || !this.isMediaCacheFailure(this.activeElement())) throw error;
      await this.recoverMediaCache(this.activeElement());
    } finally {
      this.elementPlayPending = false;
    }
  }

  pause(): void {
    this.playRequested = false;
    this.processingPaused = true;
    this.activeProcessing?.setVolume(0);
    this.cancelMemoryRecovery(false);
    this.stopLevelTimer();
    if (this.mode === "buffer") {
      this.bufPause();
      return;
    }
    this.finishFade();
    for (const el of this.elements) el?.pause();
  }

  seek(seconds: number): void {
    if (this.mode === "buffer") {
      this.bufSeek(seconds);
      return;
    }
    this.activeElement();
    this.pendingSeek = Math.max(0, seconds);
    this.applySeek();
  }

  setVolume(volume: number): void {
    this.masterVolume = sanitizeAudioValue(volume, 0, 1, 1);
    const output = this.processingPaused ? 0 : this.masterVolume;
    this.processing?.setVolume(output);
    this.bufferProcessing?.setVolume(output);
    if (!this.processing) for (const el of this.elements) if (el) el.volume = this.masterVolume;
  }

  setPlaybackRate(rate: number): void {
    this.playbackRate = Math.min(Math.max(rate, 0.5), 2);
    if (this.mode === "buffer") {
      // Anchor elapsed time using the old rate before changing the clock slope.
      const position = this.bufGetPosition();
      this.bufPosition = position;
      this.bufBaseOffset = position;
      if (this.bufCtx) this.bufSourceCtxStart = Math.max(this.bufCtx.currentTime, this.bufSourceCtxStart);
      this.bufRate = this.playbackRate;
      if (this.bufSource) this.bufSource.playbackRate.value = this.bufRate;
      this.armBufChain();
      this.emitTime();
      return;
    }
    for (const el of this.elements) {
      if (el) el.playbackRate = this.playbackRate;
    }
  }

  getPosition(): number {
    if (this.mode === "buffer") return this.bufGetPosition();
    const el = this.elements[this.activeIdx];
    return el && Number.isFinite(el.currentTime) ? el.currentTime : 0;
  }

  getDuration(): number {
    if (this.mode === "buffer") return this.buf?.duration ?? 0;
    const el = this.elements[this.activeIdx];
    return el && Number.isFinite(el.duration) ? el.duration : 0;
  }

  
  getLimiterReduction(): number | undefined {
    return this.activeProcessing?.limiter?.reduction;
  }

  getAudioProcessingState(): "active" | "standby" | "direct" {
    if (this.activeProcessing) return "active";
    return this.graphDisabled ? "direct" : "standby";
  }

  getSpectrum(data: Uint8Array): void {
    const analyser = this.activeProcessing?.spectrum;
    if (analyser) analyser.getByteFrequencyData(data);
    else data.fill(0);
  }

  private ensureBufferCtx(): boolean {
    if (this.bufCtx) return true;
    const Ctor = this.audioCtor();
    if (!Ctor) return false;
    try {
      const ctx = new Ctor();
      const g0 = ctx.createGain();
      const g1 = ctx.createGain();
      g0.gain.value = 1;
      g1.gain.value = 0;
      this.bufCtx = ctx;
      this.bufferProcessing = new AudioProcessing(ctx, this.processingSettings());
      g0.connect(this.bufferProcessing.input);
      g1.connect(this.bufferProcessing.input);
      this.bufSrcGains = [g0, g1];
      return true;
    } catch {
      this.teardownBufferCtx();
      return false;
    }
  }

  private teardownBufferCtx(): void {
    if (this.bufCtx) void this.bufCtx.close().catch(() => undefined);
    this.clearBufChain();
    this.stopLevelTimer();
    this.bufCtx = null;
    this.bufferProcessing = null;
    this.bufSrcGains = [null, null];
  }

  private resumeBufCtx(): void {
    if (this.bufCtx?.state === "suspended") {
      void this.bufCtx.resume().catch(() => undefined);
    }
  }

  private emitState(state: PlayerState): void {
    this.stateCb?.(state);
  }

  

  private switchToBufferMode(): void {
    if (this.mode === "buffer") return;
    if (!this.albumMode && isProxiedAudioUrl(this.pendingElementSrc)) return;
    this.bufRate = this.playbackRate;
    if (!this.ensureBufferCtx()) return;
    this.mode = "buffer";
    this.cancelFade();
    this.teardownGraph();
    for (const el of this.elements) {
      if (el) {
        el.onplay = el.onpause = el.onwaiting = el.onplaying = null;
        el.onended = el.onerror = el.ontimeupdate = null;
        el.onloadedmetadata = el.ondurationchange = null;
        el.pause();
        el.removeAttribute("src");
        try {
          el.load();
        } catch {
          
        }
      }
    }
    this.elements = [null, null];
  }

  private switchToElementMode(): void {
    if (this.mode === "element") return;
    this.stopTimeTimer();
    this.stopSourceNode(this.bufSource);
    this.bufSource = null;
    this.bufPlaying = false;
    this.mode = "element";
    this.graphDisabled = false;
    this.ensureElements();
    this.ensureGraph();
  }

  private scheduleProbe(): void {
    if (isProxiedAudioUrl(this.pendingElementSrc)) return;
    if (this.probed) return;
    this.probed = true;
    this.probeTimer = globalThis.setTimeout(() => {
      this.probeTimer = undefined;
      this.runProbe(false);
    }, MEDIA_ELEMENT_PROBE_MS);
    this.readyProbeTimer = globalThis.setTimeout(() => {
      this.readyProbeTimer = undefined;
      this.runProbe(true);
    }, MEDIA_ELEMENT_READY_PROBE_MS);
  }

  private runProbe(readyCheck: boolean): void {
    if (this.mode !== "element" || isHlsUrl(this.pendingElementSrc)) return;
    const el = this.elements[this.activeIdx];
    if (!el || el.error) return;
    const stuck = readyCheck ? el.readyState === 0 : el.currentSrc === "";
    if (!stuck) return;
    const src = this.pendingElementSrc;
    if (!isWebKitEngine()) {
      const host = src ? this.hostOf(src) : "";
      if (src && !this.elementProxyRetried && ["googlevideo.com", "sndcdn.com", "media-streaming.soundcloud.cloud", "dzcdn.net", "userapi.com"]
        .some((domain) => host === domain || host.endsWith(`.${domain}`))) {
        this.elementProxyRetried = true;
        const proxied = `${PROXY_BASE}/audio?url=${encodeURIComponent(src)}`;
        this.pendingElementSrc = proxied;
        el.src = proxied;
        el.load();
        if (this.playRequested) void el.play().catch(() => undefined);
      }
      return;
    }
    this.switchToBufferMode();
    if (!src) return;
    void this.bufLoad(src)
      .then(() => {
        if (this.mode !== "buffer" || !this.playRequested) return;
        this.playRequested = false;
        return this.bufStartPlayback();
      })
      .catch(() => undefined);
  }

  private hostOf(url: string): string {
    try {
      return new URL(url).host;
    } catch {
      return "";
    }
  }

  private bufFetchViaProxy(src: string): Promise<ArrayBuffer> {
    return fetch(`${PROXY_BASE}/audio?url=${encodeURIComponent(src)}`, { mode: "cors" }).then(
      (res) => {
        if (!res.ok) throw new Error(`proxy ${res.status}`);
        return res.arrayBuffer();
      },
    );
  }

  private async bufFetchBytes(src: string): Promise<ArrayBuffer> {
    if (this.albumMode && isBufferedAlbumSource(src)) {
      const controller = new AbortController();
      const timer = globalThis.setTimeout(() => controller.abort(), MEDIA_MEMORY_TIMEOUT_MS);
      try {
        return await (await fetchMediaBlob(src, controller.signal)).arrayBuffer();
      } finally {
        globalThis.clearTimeout(timer);
      }
    }
    const host = this.hostOf(src);
    if (this.proxiedHosts.has(host)) return this.bufFetchViaProxy(src);
    try {
      const res = await fetch(src, { mode: "cors" });
      if (!res.ok) throw new Error(`fetch ${res.status}`);
      return await res.arrayBuffer();
    } catch {
      this.proxiedHosts.add(host);
      return this.bufFetchViaProxy(src);
    }
  }

  private bufDecode(bytes: ArrayBuffer): Promise<AudioBuffer> {
    if (!this.bufCtx) throw new Error("no audio context");
    return this.bufCtx.decodeAudioData(bytes);
  }

  
  private cachedBuf(src: string): AudioBuffer | undefined {
    const hit = this.bufferCache.get(src);
    if (hit) {
      this.bufferCache.delete(src);
      this.bufferCache.set(src, hit);
    }
    return hit;
  }

  private cacheBuf(src: string, audio: AudioBuffer): void {
    this.bufferCache.delete(src);
    if (pcmBytes(audio) > BUFFER_CACHE_MAX_BYTES) return;
    this.bufferCache.set(src, audio);
    let bytes = 0;
    for (const buffer of this.bufferCache.values()) bytes += pcmBytes(buffer);
    for (const [oldest, buffer] of this.bufferCache) {
      if (bytes <= BUFFER_CACHE_MAX_BYTES && this.bufferCache.size <= BUFFER_CACHE_MAX) break;
      this.bufferCache.delete(oldest);
      bytes -= pcmBytes(buffer);
    }
  }

  private clampOffset(offset: number, duration: number): number {
    const max = Math.max(duration - 0.001, 0);
    return Math.min(Math.max(offset, 0), max);
  }

  private async bufLoad(src: string): Promise<void> {
    this.clearBufChain();
    if (this.bufNextUri !== src) this.cancelPreload();
    if (this.bufUri === src && this.bufDecoding) {
      await this.bufDecoding;
      return;
    }
    if (this.levelingEnabled) this.resetLevelingGain();
    if (this.bufUri === src && this.bufPlaying && this.bufSource && this.buf) {
      // Gapless-чейн уже играет этот трек — подхватываем без рестарта.
      this.bufPendingSeek = null;
      return;
    }
    
    const cached = this.cachedBuf(src);
    const preloaded = this.bufNextUri === src ? this.bufNext : null;
    if (cached || preloaded) {
      this.buf = (cached ?? preloaded)!;
      if (this.bufNextUri === src) {
        this.bufNext = null;
        this.bufNextUri = null;
      }
      this.bufUri = src;
      this.bufPosition = 0;
      if (this.bufPendingSeek !== null) {
        this.bufPosition = this.clampOffset(this.bufPendingSeek, this.buf.duration);
        this.bufPendingSeek = null;
      }
      if (this.playRequested) {
        this.playRequested = false;
        await this.bufStartPlayback();
      }
      return;
    }
    this.bufUri = src;
    this.bufLoading = true;
    
    
    
    
    const decoding = this.bufFetchBytes(src)
      .then((bytes) => this.bufDecode(bytes))
      .then((audio) => {
        if (this.bufUri !== src) return;
        this.buf = audio;
        this.cacheBuf(src, audio);
        this.bufPosition = 0;
        if (this.bufPendingSeek !== null) {
          this.bufPosition = this.clampOffset(this.bufPendingSeek, audio.duration);
          this.bufPendingSeek = null;
        }
        if (this.playRequested) {
          this.playRequested = false;
          return this.bufStartPlayback();
        }
      });
    this.bufDecoding = decoding;
    try {
      await decoding;
    } finally {
      if (this.bufUri === src) {
        this.bufLoading = false;
        this.bufDecoding = null;
      }
    }
  }

  private bufPreload(src: string): void {
    if (this.bufNextUri === src) return;
    this.clearBufChain();
    this.bufNext = null;
    const cached = this.cachedBuf(src);
    if (cached) {
      this.bufNextUri = src;
      this.bufNext = cached;
      this.armBufChain();
      return;
    }
    this.bufNextUri = src;
    this.bufFetchBytes(src)
      .then((bytes) => this.bufDecode(bytes))
      .then((audio) => {
        if (this.bufNextUri !== src || pcmBytes(audio) > BUFFER_CACHE_MAX_BYTES) return;
        this.bufNext = audio;
        this.cacheBuf(src, audio);
        // Догрузился уже во время игры — взводим gapless-чейн сразу.
        this.armBufChain();
      })
      .catch(() => {
        if (this.bufNextUri === src) {
          this.bufNextUri = null;
          this.bufNext = null;
        }
      });
  }

  private async bufPlay(): Promise<void> {
    this.playRequested = true;
    this.resumeBufCtx();
    if (this.bufLoading && this.bufDecoding) {
      await this.bufDecoding;
      if (this.bufPlaying || !this.buf) return;
      await this.bufStartPlayback();
      return;
    }
    if (this.bufPlaying && this.bufSource) return;
    if (!this.buf || !this.bufCtx) throw new Error("no buffer loaded");
    await this.bufStartPlayback();
  }

  private async bufStartPlayback(): Promise<void> {
    const ctx = this.bufCtx;
    const buf = this.buf;
    if (!ctx || !buf) throw new Error("no buffer");
    this.clearBufChain();
    this.resumeBufCtx();
    const hadSource = this.bufSource !== null;
    const oldSource = this.bufSource;
    const oldGainIdx = this.bufSourceGainIdx;
    const offset = this.bufPendingSeek !== null ? this.bufPendingSeek : this.bufPosition;
    this.bufPendingSeek = null;
    this.bufPosition = this.clampOffset(offset, buf.duration);
    this.bufSourceGainIdx = 1 - this.bufSourceGainIdx;
    const gain = this.bufSrcGains[this.bufSourceGainIdx];
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = this.bufRate;
    src.connect(gain ?? ctx.destination);
    const t = ctx.currentTime;
    const cf = hadSource && oldSource && this.crossfadeMs > 0;
    if (gain) {
      gain.gain.cancelScheduledValues(t);
      if (cf) {
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(1, t + this.crossfadeMs / 1000);
      } else {
        gain.gain.setValueAtTime(1, t);
      }
    }
    src.onended = (): void => {
      if (this.bufSource !== src) return;
      this.bufSource = null;
      this.bufPlaying = false;
      this.bufPosition = buf.duration;
      this.stopTimeTimer();
      this.emitState("ended");
      this.emitTime();
      this.endedCb?.();
    };
    src.start(t, this.bufPosition);
    this.bufSource = src;
    this.bufBaseOffset = this.bufPosition;
    this.bufSourceCtxStart = t;
    this.bufPlaying = true;
    if (this.levelingEnabled) this.startLevelTimer();
    if (cf && oldGainIdx >= 0) {
      const oldGain = this.bufSrcGains[oldGainIdx];
      if (oldGain) {
        oldGain.gain.cancelScheduledValues(t);
        oldGain.gain.setValueAtTime(oldGain.gain.value, t);
        oldGain.gain.linearRampToValueAtTime(0, t + this.crossfadeMs / 1000 + 0.02);
      }
      if (oldSource) {
        oldSource.onended = null;
        try {
          oldSource.stop(t + this.crossfadeMs / 1000 + 0.05);
        } catch {
          
        }
      }
    } else {
      this.stopSourceNode(oldSource);
    }
    this.armBufChain();
    this.emitState("playing");
    this.startTimeTimer();
  }

  private clearBufChain(): void {
    if (this.bufChainTimer !== undefined) {
      globalThis.clearTimeout(this.bufChainTimer);
      this.bufChainTimer = undefined;
    }
  }

  private armBufChain(): void {
    this.clearBufChain();
    if (this.crossfadeMs !== 0) return;
    const ctx = this.bufCtx;
    if (!ctx || !this.buf || !this.bufNext || !this.bufPlaying) return;
    const remaining = (this.buf.duration - this.bufPosition) / this.bufRate;
    const delaySec = remaining - CHAIN_LOOKAHEAD_SEC;
    if (!(delaySec > 0)) return;
    this.bufChainTimer = globalThis.setTimeout(() => this.chainBufNext(), delaySec * 1000);
  }

  /**
   * Gapless-склейка: стартуем предзагруженный следующий буфер ровно в момент
   * конца текущего по часам контекста — без участия движка и его задержек.
   * Движок потом подхватит уже играющий трек через adopt в bufLoad/bufPlay.
   */
  private chainBufNext(): void {
    this.bufChainTimer = undefined;
    if (this.mode !== "buffer") return;
    const ctx = this.bufCtx;
    const nextBuf = this.bufNext;
    const nextUri = this.bufNextUri;
    if (!ctx || !nextBuf || !nextUri || !this.buf || !this.bufPlaying || !this.bufSource) return;
    if (this.crossfadeMs !== 0) return;
    const endTime = this.bufSourceCtxStart + (this.buf.duration - this.bufBaseOffset) / this.bufRate;
    const when = Math.max(endTime, ctx.currentTime);
    const t = ctx.currentTime;
    const oldSource = this.bufSource;
    const oldGainIdx = this.bufSourceGainIdx;
    this.bufSourceGainIdx = 1 - this.bufSourceGainIdx;
    const gain = this.bufSrcGains[this.bufSourceGainIdx];
    const src = ctx.createBufferSource();
    src.buffer = nextBuf;
    src.playbackRate.value = this.bufRate;
    src.connect(gain ?? ctx.destination);
    if (gain) {
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(1, t);
    }
    const oldGain = this.bufSrcGains[oldGainIdx];
    if (oldGain) {
      oldGain.gain.cancelScheduledValues(t);
      oldGain.gain.setValueAtTime(0, when);
    }
    src.onended = (): void => {
      if (this.bufSource !== src) return;
      this.bufSource = null;
      this.bufPlaying = false;
      this.bufPosition = nextBuf.duration;
      this.stopTimeTimer();
      this.emitState("ended");
      this.emitTime();
      this.endedCb?.();
    };
    src.start(when, 0);
    if (oldSource) {
      oldSource.onended = (): void => {
        oldSource.onended = null;
        // The next source is already scheduled; let the engine adopt it at
        // the boundary and advance its queue without interrupting playback.
        if (this.bufSource === src && this.bufPlaying) this.endedCb?.();
      };
      try {
        oldSource.stop(when);
      } catch {}
    }
    this.bufSource = src;
    this.buf = nextBuf;
    this.bufUri = nextUri;
    this.bufNext = null;
    this.bufNextUri = null;
    this.bufBaseOffset = 0;
    this.bufSourceCtxStart = when;
    this.bufPosition = 0;
    this.leveler.reset();
    this.levelSmoothDb = -Infinity;
  }

  private stopSourceNode(src: AudioBufferSourceNode | null): void {
    if (!src) return;
    src.onended = null;
    try {
      src.stop();
    } catch {
      
    }
    try {
      src.disconnect();
    } catch {
      
    }
  }

  private bufPause(): void {
    this.clearBufChain();
    if (this.bufPlaying) {
      this.bufPosition = this.bufGetPosition();
      const old = this.bufSource;
      this.bufSource = null;
      this.stopSourceNode(old);
      this.bufPlaying = false;
      this.stopTimeTimer();
    }
    this.emitState("paused");
    this.emitTime();
  }

  private bufSeek(seconds: number): void {
    const dur = this.buf?.duration;
    const clamped = dur !== undefined ? this.clampOffset(seconds, dur) : Math.max(seconds, 0);
    if (this.bufLoading || !this.buf) {
      this.bufPendingSeek = clamped;
      this.bufPosition = clamped;
      this.emitTime();
      return;
    }
    this.bufPosition = clamped;
    if (this.bufPlaying) {
      void this.bufStartPlayback();
    }
    this.emitTime();
  }

  private bufGetPosition(): number {
    if (this.bufPlaying && this.bufCtx && this.bufSource) {
      const p = this.bufBaseOffset + (this.bufCtx.currentTime - this.bufSourceCtxStart) * this.bufRate;
      const d = this.buf?.duration ?? 0;
      return this.clampOffset(p, Math.max(d, 0.001));
    }
    return Math.min(this.bufPosition, this.buf?.duration ?? this.bufPosition);
  }

  private startTimeTimer(): void {
    this.stopTimeTimer();
    this.timeTimer = globalThis.setInterval(() => this.emitTime(), BUFFER_TIME_UPDATE_MS);
  }

  private stopTimeTimer(): void {
    if (this.timeTimer !== undefined) {
      globalThis.clearInterval(this.timeTimer);
      this.timeTimer = undefined;
    }
  }

  

  onStateChange(cb: StateCb): () => void {
    this.stateCb = cb;
    return () => {
      if (this.stateCb === cb) this.stateCb = null;
    };
  }

  onTimeUpdate(cb: TimeCb): () => void {
    this.timeCb = cb;
    return () => {
      if (this.timeCb === cb) this.timeCb = null;
    };
  }

  onEnded(cb: () => void): () => void {
    this.endedCb = cb;
    return () => {
      if (this.endedCb === cb) this.endedCb = null;
    };
  }

  onError(cb: (message: string) => void): () => void {
    this.errorCb = cb;
    return () => {
      if (this.errorCb === cb) this.errorCb = null;
    };
  }

  destroy(): void {
    this.playRequested = false;
    this.cancelMemoryRecovery(true);
    this.cancelFade();
    this.releaseHls();
    if (this.probeTimer !== undefined) {
      globalThis.clearTimeout(this.probeTimer);
      this.probeTimer = undefined;
    }
    if (this.readyProbeTimer !== undefined) {
      globalThis.clearTimeout(this.readyProbeTimer);
      this.readyProbeTimer = undefined;
    }
    this.stopTimeTimer();
    for (const el of this.elements) {
      if (el) {
        el.onplay = el.onpause = el.onwaiting = el.onplaying = null;
        el.onended = el.onerror = el.ontimeupdate = null;
        el.onloadedmetadata = el.ondurationchange = null;
        el.pause();
        el.removeAttribute("src");
        try {
          el.load();
        } catch {
          
        }
      }
    }
    this.elements = [null, null];
    this.teardownGraph();
    this.stopSourceNode(this.bufSource);
    this.bufSource = null;
    this.bufPlaying = false;
    this.teardownBufferCtx();
    this.buf = null;
    this.bufNext = null;
    this.bufNextUri = null;
    this.bufUri = null;
    this.bufferCache.clear();
    this.stateCb = null;
    this.timeCb = null;
    this.endedCb = null;
    this.errorCb = null;
  }
}
