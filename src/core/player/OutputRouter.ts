import type { AudioAdapter } from "./PlayerAdapter";
import type { PlayerState } from "../types";

/** Stable engine-facing adapter; output changes and loads are serialized. */
export class OutputRouter implements AudioAdapter {
  private active: AudioAdapter;
  private source: string | null = null;
  private refreshSource?: () => Promise<string>;
  private disposed = false;
  private transitioning: AudioAdapter[] = [];
  private destroyed = new WeakSet<AudioAdapter>();
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
    const work = this.queue.then(() => {
      this.assertAlive();
      return fn();
    });
    this.queue = work.catch(() => {});
    return work;
  }
  private assertAlive(): void {
    if (this.disposed) throw new Error("Audio output has been destroyed");
  }
  private disposeOutput(output: AudioAdapter): void {
    if (this.destroyed.has(output)) return;
    this.destroyed.add(output);
    output.destroy();
  }
  switchTo(next: AudioAdapter, resume = true): Promise<void> {
    return this.serial(async () => {
      if (next === this.active) return;
      const previous = this.active;
      this.transitioning = [previous, next];
      let handedOff = false;
      let playing = false;
      try {
        // This callback belongs to the loaded track, not to the current queue
        // selection, which may already have changed during a slow handoff.
        const source = this.refreshSource ? await this.refreshSource() : this.source;
        this.assertAlive();
        if (source) {
          await next.load(source);
          this.assertAlive();
          // Local playback continues while the receiver loads.
          next.seek(previous.getPosition());
        }
        next.setVolume(this.volume);
        playing = resume && this.state === "playing";
        this.detach.forEach((stop) => stop());
        previous.pause();
        this.active = next;
        handedOff = true;
        this.attach();
        if (playing && source) {
          await next.play();
          this.assertAlive();
        } else {
          this.state = "paused";
          this.states.forEach((cb) => cb("paused"));
        }
        this.source = source;
        this.times.forEach((cb) => cb(next.getPosition(), next.getDuration()));
        if (previous !== this.local) this.disposeOutput(previous);
      } catch (e) {
        if (this.disposed) {
          this.disposeOutput(previous);
        } else if (handedOff) {
          this.detach.forEach((stop) => stop());
          this.active = previous;
          this.attach();
        }
        if (next !== this.local) this.disposeOutput(next);
        if (!this.disposed && handedOff && playing) await previous.play();
        throw e;
      } finally {
        this.transitioning = [];
      }
    });
  }
  load(src: string, refreshSource?: () => Promise<string>): Promise<void> {
    return this.serial(async () => {
      await this.active.load(src);
      this.assertAlive();
      this.source = src;
      this.refreshSource = refreshSource;
    });
  }
  play(): Promise<void> {
    return this.serial(async () => {
      await this.active.play();
      this.assertAlive();
    });
  }
  private command(fn: () => void): void {
    void this.serial(async () => fn()).catch((e) =>
      this.errors.forEach((cb) => cb(String(e))),
    );
  }
  pause(): void {
    if (this.disposed) return;
    const current = this.active;
    // Stop audible playback immediately, even while the next output is loading.
    this.state = "paused";
    current.pause();
    this.states.forEach((cb) => cb("paused"));
    this.command(() => { if (this.active !== current) this.active.pause(); });
  }
  seek(seconds: number): void {
    this.command(() => this.active.seek(seconds));
  }
  preload(src: string): void {
    if (!this.disposed) this.active.preload(src);
  }
  setVolume(v: number): void {
    if (this.disposed) return;
    this.volume = v;
    this.active.setVolume(v);
  }
  setPlaybackRate(v: number): void {
    if (!this.disposed) this.local.setPlaybackRate(v);
  }
  setEqualizer(v: number[]): void {
    if (!this.disposed) this.local.setEqualizer(v);
  }
  setCrossfadeMs(v: number): void {
    if (!this.disposed) this.local.setCrossfadeMs(v);
  }
  setLeveling(a: boolean, b: number): void {
    if (!this.disposed) this.local.setLeveling(a, b);
  }
  setBassBoost(v: number): void {
    if (!this.disposed) this.local.setBassBoost(v);
  }
  setReverb(v: number): void {
    if (!this.disposed) this.local.setReverb(v);
  }
  setStereoWidth(v: number): void {
    if (!this.disposed) this.local.setStereoWidth(v);
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
    if (this.disposed) return;
    this.disposed = true;
    this.detach.forEach((stop) => stop());
    this.disposeOutput(this.active);
    this.disposeOutput(this.local);
    this.transitioning.forEach((output) => this.disposeOutput(output));
    this.states.clear();
    this.times.clear();
    this.ends.clear();
    this.errors.clear();
    this.refreshSource = undefined;
    this.source = null;
  }
}
