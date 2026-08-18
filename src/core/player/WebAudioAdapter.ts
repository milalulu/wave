import type { PlayerState } from "../types";
import type { AudioAdapter } from "./PlayerAdapter";

export const EQ_FREQUENCIES = [60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000];

export const CROSSFADE_MS = 300;

export const GAIN_TAU = 0.05;

export const PROXY_BASE = "http://127.0.0.1:8299";

export const MEDIA_ELEMENT_PROBE_MS = 1500;

export const MEDIA_ELEMENT_READY_PROBE_MS = 8000;

export const BUFFER_TIME_UPDATE_MS = 250;

export const BUFFER_CACHE_MAX = 4;

type StateCb = (state: PlayerState) => void;
type TimeCb = (position: number, duration: number) => void;
type ElementMode = "element" | "buffer";

export class WebAudioAdapter implements AudioAdapter {
  
  private elements: (HTMLAudioElement | null)[] = [null, null];
  private activeIdx = 0;
  private ctx: AudioContext | null = null;
  private fadeGains: GainNode[] = [];
  private filters: BiquadFilterNode[] = [];
  private analyser: AnalyserNode | null = null;
  private graphDisabled = false;

  
  private bassBoost: BiquadFilterNode | null = null;
  private reverbGain: GainNode | null = null;
  private dryGain: GainNode | null = null;
  private stereoPan: StereoPannerNode | null = null;
  private bassBoostGain = 0;
  private reverbMix = 0;
  private stereoWidth = 0;

  private gains: number[] = [];

  private pendingUri: string | null = null;
  private preloadedUri: string | null = null;
  private pendingSeek = 0;
  private fading = false;
  private fadeTimer: number | undefined;
  private masterVolume = 1;
  private playbackRate = 1;

  
  private mode: ElementMode = "element";
  private probed = false;
  private probeTimer: number | undefined;
  private readyProbeTimer: number | undefined;
  private pendingElementSrc: string | null = null;
  
  private playRequested = false;

  
  private bufCtx: AudioContext | null = null;
  private bufSrcGains: (GainNode | null)[] = [null, null];
  private bufFilters: BiquadFilterNode[] = [];
  private bufAnalyser: AnalyserNode | null = null;
  private bufGain: GainNode | null = null;
  private buf: AudioBuffer | null = null;
  private bufUri: string | null = null;
  private bufDecoding: Promise<void> | null = null;
  private bufLoading = false;
  private bufNext: AudioBuffer | null = null;

  
  private bufBassBoost: BiquadFilterNode | null = null;
  private bufReverbGain: GainNode | null = null;
  private bufDryGain: GainNode | null = null;
  private bufStereoPan: StereoPannerNode | null = null;
  private bufNextUri: string | null = null;
  private bufSource: AudioBufferSourceNode | null = null;
  private bufSourceGainIdx = 0;
  private bufBaseOffset = 0;
  private bufSourceCtxStart = 0;
  private bufPosition = 0;
  private bufPlaying = false;
  private bufVolume = 1;
  private bufRate = 1;
  private bufPendingSeek: number | null = null;
  private timeTimer: number | undefined;
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
      if (isActive()) this.stateCb?.("paused");
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
      
      
      
      if (isActive() && !this.graphDisabled && this.ctx && el.crossOrigin) {
        const src = el.currentSrc || el.src;
        this.teardownGraph();
        this.graphDisabled = true;
        this.elements = [null, null];
        this.ensureElements();
        const next = this.activeElement();
        next.crossOrigin = null;
        if (src) {
          next.src = src;
          next.load();
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
    if (!el || this.pendingSeek <= 0 || !Number.isFinite(el.duration)) return;
    try {
      el.currentTime = Math.min(this.pendingSeek, Math.max(el.duration, 0));
      this.pendingSeek = 0;
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
      const src0 = ctx.createMediaElementSource(this.elements[0]!);
      const src1 = ctx.createMediaElementSource(this.elements[1]!);
      const g0 = ctx.createGain();
      const g1 = ctx.createGain();
      g0.gain.value = 1;
      g1.gain.value = 0;
      this.filters = EQ_FREQUENCIES.map((freq, i) => {
        const filter = ctx.createBiquadFilter();
        filter.type =
          i === 0 ? "lowshelf" : i === EQ_FREQUENCIES.length - 1 ? "highshelf" : "peaking";
        filter.frequency.value = freq;
        filter.Q.value = 1;
        filter.gain.value = 0;
        return filter;
      });
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 256;
      src0.connect(g0);
      src1.connect(g1);
      g0.connect(this.filters[0]);
      g1.connect(this.filters[0]);
      let node: AudioNode = this.filters[0];
      for (let i = 1; i < this.filters.length; i++) {
        node.connect(this.filters[i]);
        node = this.filters[i];
      }
      const fx = this.insertEffectNodes(ctx, node as BiquadFilterNode, this.analyser);
      this.bassBoost = fx.bassBoost;
      this.reverbGain = fx.reverbGain;
      this.dryGain = fx.dryGain;
      this.stereoPan = fx.stereoPan;
      this.fadeGains = [g0, g1];
      this.ctx = ctx;
      this.applyGains();
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
    this.ctx = null;
    this.fadeGains = [];
    this.filters = [];
    this.analyser = null;
    this.bassBoost = null;
    this.reverbGain = null;
    this.dryGain = null;
    this.stereoPan = null;
  }

  private static generateImpulse(ctx: AudioContext, duration = 2, decay = 2): AudioBuffer {
    const rate = ctx.sampleRate;
    const length = rate * duration;
    const buffer = ctx.createBuffer(2, length, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
      }
    }
    return buffer;
  }

  private insertEffectNodes(
    ctx: AudioContext,
    lastFilter: BiquadFilterNode,
    analyser: AnalyserNode,
  ): { bassBoost: BiquadFilterNode; reverb: ConvolverNode; reverbGain: GainNode; dryGain: GainNode; stereoPan: StereoPannerNode } {
    const bb = ctx.createBiquadFilter();
    bb.type = "lowshelf";
    bb.frequency.value = 150;
    bb.gain.value = this.bassBoostGain;

    const conv = ctx.createConvolver();
    conv.buffer = WebAudioAdapter.generateImpulse(ctx);

    const revGain = ctx.createGain();
    revGain.gain.value = this.reverbMix;

    const dryGain = ctx.createGain();
    dryGain.gain.value = 1 - this.reverbMix * 0.5;

    const pan = ctx.createStereoPanner();
    pan.pan.value = this.stereoWidth;

    lastFilter.connect(bb);
    bb.connect(dryGain);
    bb.connect(conv);
    conv.connect(revGain);
    dryGain.connect(pan);
    revGain.connect(pan);
    pan.connect(analyser);
    analyser.connect(ctx.destination);

    return { bassBoost: bb, reverb: conv, reverbGain: revGain, dryGain, stereoPan: pan };
  }

  private resumeCtx(): void {
    if (this.ctx?.state === "suspended") {
      void this.ctx.resume().catch(() => undefined);
    }
  }

  private applyGains(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.filters.forEach((filter, i) => {
      const g = Math.min(Math.max(this.gains[i] ?? 0, -12), 12);
      filter.gain.setTargetAtTime(g, t, GAIN_TAU);
    });
  }

  
  private rebalanceGains(): void {
    if (!this.ctx || this.fadeGains.length !== 2) return;
    const t = this.ctx.currentTime;
    this.fadeGains[this.activeIdx].gain.setTargetAtTime(1, t, GAIN_TAU);
    this.fadeGains[1 - this.activeIdx].gain.setTargetAtTime(0, t, GAIN_TAU);
  }

  private cancelFade(): void {
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
    if (next.currentSrc !== uri) {
      next.src = uri;
      next.load();
    }
    next.volume = this.masterVolume;
    next.playbackRate = this.playbackRate;
    const prevGain = this.fadeGains[this.activeIdx];
    const nextGain = this.fadeGains[1 - this.activeIdx];
    const t = this.ctx.currentTime;
    prevGain.gain.setTargetAtTime(0, t, GAIN_TAU);
    nextGain.gain.setTargetAtTime(1, t, GAIN_TAU);
    this.fading = true;
    this.fadeTimer = globalThis.setTimeout(() => this.finishFade(), this.crossfadeMs + 60);
    try {
      await next.play();
    } catch (err) {
      this.finishFade();
      throw err;
    }
  }

  

  async load(src: string): Promise<void> {
    if (this.mode === "buffer") {
      await this.bufLoad(src);
      return;
    }
    this.playRequested = false;
    this.pendingElementSrc = src;
    this.ensureGraph();
    this.cancelFade();
    const active = this.activeElement();
    this.pendingSeek = 0;
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
    active.load();
    this.preloadedUri = null;
    this.scheduleProbe();
  }

  
  preload(src: string): void {
    if (this.mode === "buffer") {
      this.bufPreload(src);
      return;
    }
    const active = this.activeElement();
    const next = this.inactiveElement();
    if (!active.currentSrc || !next) return;
    
    
    if (!next.paused) return;
    if (this.preloadedUri === src) return;
    this.preloadedUri = src;
    next.volume = this.masterVolume;
    next.playbackRate = this.playbackRate;
    next.src = src;
    next.load();
  }

  
  setEqualizer(gains: number[]): void {
    this.gains = [...gains];
    if (this.mode === "buffer") {
      this.applyBufGains();
    } else {
      this.applyGains();
    }
  }

  setBassBoost(db: number): void {
    this.bassBoostGain = Math.min(Math.max(db, 0), 15);
    const t = this.ctx?.currentTime ?? 0;
    if (this.bassBoost) this.bassBoost.gain.setTargetAtTime(this.bassBoostGain, t, GAIN_TAU);
    if (this.bufBassBoost) this.bufBassBoost.gain.setTargetAtTime(this.bassBoostGain, t, GAIN_TAU);
  }

  setReverb(mix: number): void {
    this.reverbMix = Math.min(Math.max(mix, 0), 1);
    const t = this.ctx?.currentTime ?? 0;
    if (this.reverbGain) this.reverbGain.gain.setTargetAtTime(this.reverbMix, t, GAIN_TAU);
    if (this.dryGain) this.dryGain.gain.setTargetAtTime(1 - this.reverbMix * 0.5, t, GAIN_TAU);
    if (this.bufReverbGain) this.bufReverbGain.gain.setTargetAtTime(this.reverbMix, t, GAIN_TAU);
    if (this.bufDryGain) this.bufDryGain.gain.setTargetAtTime(1 - this.reverbMix * 0.5, t, GAIN_TAU);
  }

  setStereoWidth(pan: number): void {
    this.stereoWidth = Math.min(Math.max(pan, -1), 1);
    const t = this.ctx?.currentTime ?? 0;
    if (this.stereoPan) this.stereoPan.pan.setTargetAtTime(this.stereoWidth, t, GAIN_TAU);
    if (this.bufStereoPan) this.bufStereoPan.pan.setTargetAtTime(this.stereoWidth, t, GAIN_TAU);
  }

  async play(): Promise<void> {
    this.playRequested = true;
    if (this.mode === "buffer") {
      await this.bufPlay();
      return;
    }
    this.resumeCtx();
    const pending = this.pendingUri;
    this.pendingUri = null;
    if (pending !== null && this.ctx) {
      await this.startCrossfade(pending);
      return;
    }
    await this.activeElement().play();
  }

  pause(): void {
    this.playRequested = false;
    if (this.mode === "buffer") {
      this.bufPause();
      return;
    }
    this.finishFade();
    this.activeElement().pause();
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
    this.masterVolume = Math.min(Math.max(volume, 0), 1);
    if (this.mode === "buffer") {
      this.bufVolume = this.masterVolume;
      if (this.bufGain && this.bufCtx) {
        this.bufGain.gain.setTargetAtTime(this.bufVolume, this.bufCtx.currentTime, GAIN_TAU);
      }
      return;
    }
    for (const el of this.elements) {
      if (el) el.volume = this.masterVolume;
    }
  }

  setPlaybackRate(rate: number): void {
    this.playbackRate = Math.min(Math.max(rate, 0.5), 2);
    if (this.mode === "buffer") {
      this.bufRate = this.playbackRate;
      if (this.bufSource) this.bufSource.playbackRate.value = this.bufRate;
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

  
  getSpectrum(data: Uint8Array): void {
    if (this.mode === "buffer") {
      if (this.bufAnalyser && this.bufCtx) {
        this.bufAnalyser.getByteFrequencyData(data);
      } else {
        data.fill(0);
      }
      return;
    }
    if (this.analyser && this.ctx) {
      this.analyser.getByteFrequencyData(data);
    } else {
      data.fill(0);
    }
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
      this.bufFilters = EQ_FREQUENCIES.map((freq, i) => {
        const filter = ctx.createBiquadFilter();
        filter.type =
          i === 0 ? "lowshelf" : i === EQ_FREQUENCIES.length - 1 ? "highshelf" : "peaking";
        filter.frequency.value = freq;
        filter.Q.value = 1;
        filter.gain.value = 0;
        return filter;
      });
      this.bufAnalyser = ctx.createAnalyser();
      this.bufAnalyser.fftSize = 256;
      g0.connect(this.bufFilters[0]);
      g1.connect(this.bufFilters[0]);
      let node: AudioNode = this.bufFilters[0];
      for (let i = 1; i < this.bufFilters.length; i++) {
        node.connect(this.bufFilters[i]);
        node = this.bufFilters[i];
      }

      this.bufBassBoost = ctx.createBiquadFilter();
      this.bufBassBoost.type = "lowshelf";
      this.bufBassBoost.frequency.value = 150;
      this.bufBassBoost.gain.value = this.bassBoostGain;

      const bufReverb = ctx.createConvolver();
      bufReverb.buffer = WebAudioAdapter.generateImpulse(ctx);

      this.bufReverbGain = ctx.createGain();
      this.bufReverbGain.gain.value = this.reverbMix;

      this.bufDryGain = ctx.createGain();
      this.bufDryGain.gain.value = 1 - this.reverbMix * 0.5;

      this.bufStereoPan = ctx.createStereoPanner();
      this.bufStereoPan.pan.value = this.stereoWidth;

      node.connect(this.bufBassBoost);
      this.bufBassBoost.connect(this.bufDryGain);
      this.bufBassBoost.connect(bufReverb);
      bufReverb.connect(this.bufReverbGain);
      this.bufDryGain.connect(this.bufStereoPan);
      this.bufReverbGain.connect(this.bufStereoPan);
      this.bufStereoPan.connect(this.bufAnalyser);

      const master = ctx.createGain();
      master.gain.value = this.bufVolume;
      this.bufAnalyser.connect(master);
      master.connect(ctx.destination);
      this.bufCtx = ctx;
      this.bufSrcGains = [g0, g1];
      this.bufGain = master;
      this.applyBufGains();
      return true;
    } catch {
      this.bufCtx = null;
      this.bufGain = null;
      this.bufSrcGains = [null, null];
      this.bufFilters = [];
      this.bufAnalyser = null;
      this.bufBassBoost = null;
      this.bufReverbGain = null;
      this.bufDryGain = null;
      this.bufStereoPan = null;
      return false;
    }
  }

  private teardownBufferCtx(): void {
    if (this.bufCtx) {
      void this.bufCtx.close().catch(() => undefined);
    }
    this.bufCtx = null;
    this.bufGain = null;
    this.bufSrcGains = [null, null];
    this.bufFilters = [];
    this.bufAnalyser = null;
    this.bufBassBoost = null;
    this.bufReverbGain = null;
    this.bufDryGain = null;
    this.bufStereoPan = null;
  }

  private resumeBufCtx(): void {
    if (this.bufCtx?.state === "suspended") {
      void this.bufCtx.resume().catch(() => undefined);
    }
  }

  private applyBufGains(): void {
    if (!this.bufCtx) return;
    const t = this.bufCtx.currentTime;
    this.bufFilters.forEach((filter, i) => {
      const g = Math.min(Math.max(this.gains[i] ?? 0, -12), 12);
      filter.gain.setTargetAtTime(g, t, GAIN_TAU);
    });
  }

  private emitState(state: PlayerState): void {
    this.stateCb?.(state);
  }

  

  private switchToBufferMode(): void {
    if (this.mode === "buffer") return;
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

  

  private scheduleProbe(): void {
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
    if (this.mode !== "element") return;
    const el = this.elements[0];
    if (!el || el.error) return;
    const stuck = readyCheck ? el.readyState === 0 : el.currentSrc === "";
    if (!stuck) return;
    const src = this.pendingElementSrc;
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
    if (this.bufferCache.has(src)) this.bufferCache.delete(src);
    this.bufferCache.set(src, audio);
    while (this.bufferCache.size > BUFFER_CACHE_MAX) {
      const oldest = this.bufferCache.keys().next().value;
      if (oldest === undefined) break;
      this.bufferCache.delete(oldest);
    }
  }

  private clampOffset(offset: number, duration: number): number {
    const max = Math.max(duration - 0.001, 0);
    return Math.min(Math.max(offset, 0), max);
  }

  private async bufLoad(src: string): Promise<void> {
    
    if (this.bufUri === src && this.bufDecoding) {
      await this.bufDecoding;
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
    if (this.bufNextUri === src || this.cachedBuf(src)) return;
    this.bufNextUri = src;
    this.bufFetchBytes(src)
      .then((bytes) => this.bufDecode(bytes))
      .then((audio) => {
        if (this.bufNextUri === src) {
          this.bufNext = audio;
          this.cacheBuf(src, audio);
        }
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
    if (!this.buf || !this.bufCtx) throw new Error("no buffer loaded");
    await this.bufStartPlayback();
  }

  private async bufStartPlayback(): Promise<void> {
    const ctx = this.bufCtx;
    const buf = this.buf;
    if (!ctx || !buf) throw new Error("no buffer");
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
    this.emitState("playing");
    this.startTimeTimer();
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
    this.cancelFade();
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
