import type { PlayerState } from "../types";
import type { AudioAdapter } from "./PlayerAdapter";

/** Частоты 10-полосного эквалайзера. */
export const EQ_FREQUENCIES = [60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000];

/** Длительность кроссфейда между треками. */
export const CROSSFADE_MS = 300;
/** Постоянная времени сглаживания gain (де-зиппинг, чтобы не щёлкало). */
export const GAIN_TAU = 0.05;

type StateCb = (state: PlayerState) => void;
type TimeCb = (position: number, duration: number) => void;

/**
 * Двухэлементный адаптер: HTML5 `<audio>` + WebAudio.
 *
 * Граф строится ОДИН раз на свежих (никогда не игравших) элементах до начала
 * воспроизведения — это обходит баг WebKitGTK, где `createMediaElementSource`
 * на уже играющем элементе обрубает звук. Маршрутизация после этого не
 * пересоздаётся: EQ включается/выключается изменением gain, кроссфейд — плавным
 * перетеканием между двумя элементами, визуализатор читает общий analyser.
 *
 * Топология:
 *   el0 → MediaElementSource → gain0 ─┐
 *                                     ├─ EQ (10 biquad) → analyser → destination
 *   el1 → MediaElementSource → gain1 ─┘
 *
 * Смена трека при воспроизведении = кроссфейд (300 мс); `preload()` подогревает
 * неактивный элемент, чтобы переключение было бесшовным.
 */
export class WebAudioAdapter implements AudioAdapter {
  private elements: (HTMLAudioElement | null)[] = [null, null];
  private activeIdx = 0;
  private ctx: AudioContext | null = null;
  private fadeGains: GainNode[] = [];
  private filters: BiquadFilterNode[] = [];
  private analyser: AnalyserNode | null = null;
  private graphDisabled = false;

  private gains: number[] = [];

  private pendingUri: string | null = null;
  private preloadedUri: string | null = null;
  private pendingSeek = 0;
  private fading = false;
  private fadeTimer: number | undefined;
  private masterVolume = 1;
  private playbackRate = 1;

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
        // CORS-режим обязателен для кросс-доменного аудио через WebAudio: без него
        // Chromium (WebView2/Windows) отдаёт тишину, а WebKitGTK играет нормально.
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
      // CORS-ошибка (источник без Access-Control-Allow-Origin): разбираем граф —
      // кросс-доменное аудио внутри него на Chromium глушится. Звук идёт напрямую
      // из элемента (без EQ), источник пробуем ещё раз без CORS-режима.
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
      if (isActive()) this.errorCb?.(`audio error code ${el.error?.code ?? "unknown"}`);
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
    const el = this.activeElement();
    if (!el) return;
    const duration = Number.isFinite(el.duration) ? el.duration : 0;
    this.timeCb(el.currentTime, duration);
  }

  private applySeek(): void {
    const el = this.activeElement();
    if (el && this.pendingSeek > 0 && Number.isFinite(el.duration)) {
      el.currentTime = Math.min(this.pendingSeek, Math.max(el.duration, 0));
      this.pendingSeek = 0;
    }
  }

  private audioCtor(): typeof AudioContext | null {
    return (
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ??
      null
    );
  }

  /**
   * Построить персистентный граф на свежих элементах. При неудаче элементы
   * пересоздаются (могли быть привязаны к закрытому контексту) и звук идёт
   * напрямую через элемент — без графа.
   */
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
      node.connect(this.analyser);
      this.analyser.connect(ctx.destination);
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

  /** Завершить кроссфейд: пауза старого элемента, активация нового. */
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
    void prev.play().catch(() => undefined);
  }

  load(src: string): void {
    this.ensureGraph();
    const active = this.activeElement();
    this.pendingSeek = 0;
    const playing = !active.paused && !active.ended;
    if (playing && this.ctx) {
      this.pendingUri = src;
      return;
    }
    const next = this.inactiveElement();
    if (next && next.currentSrc === src) {
      this.swapActive();
      next.currentTime = 0;
      return;
    }
    active.src = src;
    active.load();
    this.preloadedUri = null;
  }

  /** Подогреть неактивный элемент следующим треком (бесшовное переключение). */
  preload(src: string): void {
    const active = this.activeElement();
    const next = this.inactiveElement();
    if (!active.currentSrc || !next) return;
    // Неактивный элемент играет — идёт кроссфейд на него; перезаписывать
    // src сейчас нельзя (прервёт переход). Пропускаем предзагрузку.
    if (!next.paused) return;
    if (this.preloadedUri === src) return;
    this.preloadedUri = src;
    next.volume = this.masterVolume;
    next.playbackRate = this.playbackRate;
    next.src = src;
    next.load();
  }

  /** Включить/переключить эквалайзер. Граф не пересоздаётся. */
  setEqualizer(gains: number[]): void {
    this.gains = [...gains];
    this.applyGains();
  }

  async play(): Promise<void> {
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
    this.finishFade();
    this.activeElement().pause();
  }

  seek(seconds: number): void {
    this.activeElement();
    this.pendingSeek = Math.max(0, seconds);
    this.applySeek();
  }

  setVolume(volume: number): void {
    this.masterVolume = Math.min(Math.max(volume, 0), 1);
    for (const el of this.elements) {
      if (el) el.volume = this.masterVolume;
    }
  }

  setPlaybackRate(rate: number): void {
    this.playbackRate = Math.min(Math.max(rate, 0.5), 2);
    for (const el of this.elements) {
      if (el) el.playbackRate = this.playbackRate;
    }
  }

  getPosition(): number {
    const el = this.elements[this.activeIdx];
    return el && Number.isFinite(el.currentTime) ? el.currentTime : 0;
  }

  getDuration(): number {
    const el = this.elements[this.activeIdx];
    return el && Number.isFinite(el.duration) ? el.duration : 0;
  }

  /** Заполнить массив спектральными данными (0, если граф недоступен). */
  getSpectrum(data: Uint8Array): void {
    if (this.analyser && this.ctx) {
      this.analyser.getByteFrequencyData(data);
    } else {
      data.fill(0);
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
          /* ignore */
        }
      }
    }
    this.elements = [null, null];
    this.teardownGraph();
    this.stateCb = null;
    this.timeCb = null;
    this.endedCb = null;
    this.errorCb = null;
  }
}
