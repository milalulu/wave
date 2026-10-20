import type { AudioAdapter } from "./PlayerAdapter";
import type { PlayerState } from "../types";

/** Stable engine-facing adapter; output changes and loads are serialized. */
export class OutputRouter implements AudioAdapter {
  private active: AudioAdapter;
  private source: string | null = null;
  private state: PlayerState = "idle";
  private volume = 1;
  private queue: Promise<unknown> = Promise.resolve();
  private detach: (() => void)[] = [];
  private states = new Set<(s: PlayerState) => void>();
  private times = new Set<(p: number, d: number) => void>();
  private ends = new Set<() => void>();
  private errors = new Set<(message: string) => void>();
  constructor(readonly local: AudioAdapter) {
    this.active = local;
    this.attach();
  }
  private attach(): void {
    this.detach = [
      this.active.onStateChange((s) => {
        this.state = s;
        this.states.forEach((cb) => cb(s));
      }),
      this.active.onTimeUpdate((p, d) => this.times.forEach((cb) => cb(p, d))),
      this.active.onEnded(() => this.ends.forEach((cb) => cb())),
      this.active.onError((e) => this.errors.forEach((cb) => cb(e))),
    ];
  }
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const work = this.queue.then(fn);
    this.queue = work.catch(() => {});
    return work;
  }
  switchTo(next: AudioAdapter, resume = true): Promise<void> {
    return this.serial(async () => {
      if (next === this.active) return;
      const previous = this.active,
        playing = resume && this.state === "playing",
        position = previous.getPosition();
      if (this.source) {
        await next.load(this.source);
        next.seek(position);
      }
      next.setVolume(this.volume);
      this.detach.forEach((stop) => stop());
      previous.pause();
      this.active = next;
      this.attach();
      try {
        if (playing && this.source) await next.play();
        else {
          this.state = "paused";
          this.states.forEach((cb) => cb("paused"));
        }
        this.times.forEach((cb) => cb(next.getPosition(), next.getDuration()));
        if (previous !== this.local) previous.destroy();
      } catch (e) {
        this.detach.forEach((stop) => stop());
        this.active = previous;
        this.attach();
        if (next !== this.local) next.destroy();
        if (playing) await previous.play();
        throw e;
      }
    });
  }
  load(src: string): Promise<void> {
    return this.serial(async () => {
      await this.active.load(src);
      this.source = src;
    });
  }
  play(): Promise<void> {
    return this.serial(() => this.active.play());
  }
  private command(fn: () => void): void {
    void this.serial(async () => fn()).catch((e) =>
      this.errors.forEach((cb) => cb(String(e))),
    );
  }
  pause(): void {
    this.command(() => this.active.pause());
  }
  seek(seconds: number): void {
    this.command(() => this.active.seek(seconds));
  }
  preload(src: string): void {
    this.active.preload(src);
  }
  setVolume(v: number): void {
    this.volume = v;
    this.active.setVolume(v);
  }
  setPlaybackRate(v: number): void {
    this.local.setPlaybackRate(v);
  }
  setEqualizer(v: number[]): void {
    this.local.setEqualizer(v);
  }
  setCrossfadeMs(v: number): void {
    this.local.setCrossfadeMs(v);
  }
  setLeveling(a: boolean, b: number): void {
    this.local.setLeveling(a, b);
  }
  setBassBoost(v: number): void {
    this.local.setBassBoost(v);
  }
  setReverb(v: number): void {
    this.local.setReverb(v);
  }
  setStereoWidth(v: number): void {
    this.local.setStereoWidth(v);
  }
  getPosition(): number {
    return this.active.getPosition();
  }
  getDuration(): number {
    return this.active.getDuration();
  }
  getSpectrum(data: Uint8Array): void {
    this.active.getSpectrum(data);
  }
  onStateChange(cb: (s: PlayerState) => void): () => void {
    this.states.add(cb);
    return () => {
      this.states.delete(cb);
    };
  }
  onTimeUpdate(cb: (p: number, d: number) => void): () => void {
    this.times.add(cb);
    return () => {
      this.times.delete(cb);
    };
  }
  onEnded(cb: () => void): () => void {
    this.ends.add(cb);
    return () => {
      this.ends.delete(cb);
    };
  }
  onError(cb: (e: string) => void): () => void {
    this.errors.add(cb);
    return () => {
      this.errors.delete(cb);
    };
  }
  destroy(): void {
    this.detach.forEach((stop) => stop());
    this.active.destroy();
    if (this.active !== this.local) this.local.destroy();
  }
}
