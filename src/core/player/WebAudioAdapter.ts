import type { PlayerState } from "../types";
import type { AudioAdapter } from "./PlayerAdapter";

/** Частоты 10-полосного эквалайзера. */
export const EQ_FREQUENCIES = [60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000];

/**
 * HTML5 `<audio>`-адаптер. Кросс-платформенный (desktop + webview Android).
 * Поток (uri) задаётся через load(); события транслируются движку.
 * Эквалайзер активируется только при ненулевых усилениях: тогда аудио
 * маршрутизируется через цепочку BiquadFilter в AudioContext.
 */
export class WebAudioAdapter implements AudioAdapter {
  private audio: HTMLAudioElement | null = null;
  private pendingSeek = 0;
  private ctx: AudioContext | null = null;
  private filters: BiquadFilterNode[] = [];
  private gains: number[] = [];

  private ensure(): HTMLAudioElement {
    if (!this.audio) {
      const audio = new Audio();
      audio.preload = "auto";
      this.audio = audio;
    }
    return this.audio;
  }

  private applySeek(): void {
    const audio = this.audio;
    if (audio && this.pendingSeek > 0 && Number.isFinite(audio.duration)) {
      audio.currentTime = Math.min(this.pendingSeek, Math.max(audio.duration, 0));
      this.pendingSeek = 0;
    }
  }

  private initGraph(): void {
    const audio = this.audio;
    if (!audio || this.ctx) return;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    const source = ctx.createMediaElementSource(audio);
    this.filters = EQ_FREQUENCIES.map((freq, i) => {
      const filter = ctx.createBiquadFilter();
      filter.type = i === 0 ? "lowshelf" : i === EQ_FREQUENCIES.length - 1 ? "highshelf" : "peaking";
      filter.frequency.value = freq;
      filter.Q.value = 1;
      filter.gain.value = 0;
      return filter;
    });
    let node: AudioNode = source;
    for (const filter of this.filters) {
      node.connect(filter);
      node = filter;
    }
    node.connect(ctx.destination);
    this.ctx = ctx;
  }

  private applyGains(): void {
    this.filters.forEach((filter, i) => {
      const g = this.gains[i] ?? 0;
      filter.gain.value = Math.min(Math.max(g, -12), 12);
    });
  }

  private routeIfNeeded(): void {
    if (this.gains.some((g) => g !== 0)) {
      this.initGraph();
      this.applyGains();
    }
  }

  setEqualizer(gains: number[]): void {
    this.gains = [...gains];
    this.routeIfNeeded();
  }

  load(src: string): void {
    const audio = this.ensure();
    this.pendingSeek = 0;
    audio.src = src;
    audio.currentTime = 0;
    audio.load();
    this.routeIfNeeded();
  }

  async play(): Promise<void> {
    if (this.ctx?.state === "suspended") {
      await this.ctx.resume().catch(() => undefined);
    }
    await this.ensure().play();
  }

  pause(): void {
    this.ensure().pause();
  }

  seek(seconds: number): void {
    this.ensure();
    this.pendingSeek = Math.max(0, seconds);
    this.applySeek();
  }

  setVolume(volume: number): void {
    this.ensure().volume = Math.min(Math.max(volume, 0), 1);
  }

  setPlaybackRate(rate: number): void {
    const audio = this.ensure();
    audio.playbackRate = Math.min(Math.max(rate, 0.5), 2);
  }

  getPosition(): number {
    const audio = this.audio;
    return audio && Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
  }

  getDuration(): number {
    const audio = this.audio;
    return audio && Number.isFinite(audio.duration) ? audio.duration : 0;
  }

  onStateChange(cb: (state: PlayerState) => void): () => void {
    const audio = this.ensure();
    const toState = (): PlayerState => (audio.paused ? "paused" : "playing");
    const onPlay = (): void => cb(toState());
    const onPause = (): void => cb(toState());
    const onWaiting = (): void => cb("loading");
    const onPlaying = (): void => cb(toState());
    const onEnded = (): void => cb("ended");
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("waiting", onWaiting);
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("ended", onEnded);
    };
  }

  onTimeUpdate(cb: (position: number, duration: number) => void): () => void {
    const audio = this.ensure();
    const onTime = (): void => {
      const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
      cb(audio.currentTime, duration);
    };
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", () => {
      this.applySeek();
      onTime();
    });
    audio.addEventListener("durationchange", onTime);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onTime);
      audio.removeEventListener("durationchange", onTime);
    };
  }

  onEnded(cb: () => void): () => void {
    const audio = this.ensure();
    audio.addEventListener("ended", cb);
    return () => audio.removeEventListener("ended", cb);
  }

  onError(cb: (message: string) => void): () => void {
    const audio = this.ensure();
    const onError = (): void => {
      const code = audio.error?.code;
      cb(`audio error code ${code ?? "unknown"}`);
    };
    audio.addEventListener("error", onError);
    return () => audio.removeEventListener("error", onError);
  }

  destroy(): void {
    if (this.audio) {
      this.audio.pause();
      this.audio.removeAttribute("src");
      this.audio.load();
      this.audio = null;
    }
    if (this.ctx) {
      void this.ctx.close().catch(() => undefined);
      this.ctx = null;
      this.filters = [];
    }
  }
}
