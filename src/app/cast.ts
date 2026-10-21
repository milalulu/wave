import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import type { AudioAdapter } from "../core/player/PlayerAdapter";
import { EventEmitter } from "../core/util/EventEmitter";
import type { PlayerState } from "../core/types";
import type { OutputRouter } from "../core/player/OutputRouter";

export interface CastDevice {
  name: string;
  address: string;
  port: number;
}
interface RemoteStatus {
  state: PlayerState;
  position: number;
  duration: number;
  finished: boolean;
  failed: boolean;
}
// Uses the same callback contract as local audio; the engine owns the queue.
export class NativeCastAdapter
  extends EventEmitter<{
    state: PlayerState;
    time: { position: number; duration: number };
    ended: void;
    error: string;
  }>
  implements AudioAdapter
{
  src = "";
  position = 0;
  duration = 0;
  volume = 1;
  private setState(state: PlayerState): void {
    if (!this.disposed) this.emit("state", state);
  }
  private tick(position: number): void {
    this.position = position;
    this.emit("time", { position, duration: this.duration });
  }
  private fail(message: string): void {
    this.emit("error", message);
  }
  private end(): void {
    this.emit("ended", undefined);
  }
  preload(_src: string): void {}
  getSpectrum(data: Uint8Array): void {
    data.fill(0);
  }
  setPlaybackRate(_rate: number): void {}
  setEqualizer(_gains: number[]): void {}
  setCrossfadeMs(_ms: number): void {}
  setLeveling(_enabled: boolean, _db: number): void {}
  setBassBoost(_db: number): void {}
  setReverb(_mix: number): void {}
  setStereoWidth(_pan: number): void {}
  getPosition(): number {
    return this.position;
  }
  getDuration(): number {
    return this.duration;
  }
  onStateChange(cb: (state: PlayerState) => void): () => void {
    return this.on("state", cb);
  }
  onTimeUpdate(cb: (p: number, d: number) => void): () => void {
    return this.on("time", ({ position, duration }) => cb(position, duration));
  }
  onEnded(cb: () => void): () => void {
    return this.on("ended", cb);
  }
  onError(cb: (error: string) => void): () => void {
    return this.on("error", cb);
  }
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  private lostReported = false;
  private finished = false;
  private revision = 0;
  private commands: Promise<unknown> = Promise.resolve();
  constructor(
    private id: number,
    private lost: (error: string) => void,
  ) {
    super();
  }
  private send(action: string, value?: number): Promise<void> {
    const work = this.commands.then(() => {
      if (this.disposed || this.lostReported)
        throw new Error("Cast session has ended");
      return invoke<void>("cast_control", { id: this.id, action, value });
    });
    this.commands = work.catch(() => {});
    return work;
  }
  async load(src: string): Promise<void> {
    if (this.disposed || this.lostReported) throw new Error("Cast session has ended");
    const revision = ++this.revision;
    clearTimeout(this.timer);
    this.finished = false;
    await this.commands;
    if (this.disposed || revision !== this.revision) throw new Error("Cast load cancelled");
    await invoke("cast_load", { id: this.id, src });
    if (this.disposed || revision !== this.revision) throw new Error("Cast load cancelled");
    this.src = src;
    this.position = 0;
    this.setState("paused");
    this.poll();
  }
  async play(): Promise<void> {
    await this.send("play");
    this.setState("playing");
  }
  pause(): void {
    void this.send("pause")
      .then(() => this.setState("paused"))
      .catch((e) => this.connectionLost(e));
  }
  seek(seconds: number): void {
    this.position = seconds;
    void this.send("seek", seconds).catch((e) => this.connectionLost(e));
  }
  setVolume(volume: number): void {
    this.volume = volume;
    void this.send("volume", volume).catch((e) => this.connectionLost(e));
  }
  private connectionLost(error: unknown): void {
    if (this.disposed || this.lostReported) return;
    this.lostReported = true;
    this.revision++;
    clearTimeout(this.timer);
    this.lost(String(error));
  }
  private poll(): void {
    if (this.disposed || this.lostReported) return;
    const revision = this.revision;
    this.timer = setTimeout(() => {
      void invoke<RemoteStatus>("cast_status", { id: this.id })
        .then((status) => {
          if (this.disposed || revision !== this.revision) return;
          this.duration = status.duration;
          this.tick(status.position);
          this.setState(status.state);
          if (status.failed) {
            this.fail("Cast could not play this stream");
            return;
          }
          if (status.finished && !this.finished) {
            this.finished = true;
            this.end();
            return;
          }
          this.poll();
        })
        .catch((e) => {
          if (!this.disposed && revision === this.revision)
            this.connectionLost(e);
        });
    }, 1000);
  }
  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.revision++;
    clearTimeout(this.timer);
    this.clear();
    void invoke("cast_disconnect", { id: this.id }).catch(() => {});
  }
}
interface CastStore {
  device: CastDevice | null;
  busy: boolean;
  error: string | null;
  connect: (device: CastDevice, router: OutputRouter) => Promise<void>;
  disconnect: (router: OutputRouter) => Promise<void>;
}
let connectionGeneration = 0;
export const useCast = create<CastStore>((set, get) => ({
  device: null,
  busy: false,
  error: null,
  connect: async (device, router) => {
    if (get().busy) return;
    const generation = ++connectionGeneration;
    set({ busy: true, error: null });
    let adapter: NativeCastAdapter | undefined;
    try {
      const id = await invoke<number>("cast_connect", {
        address: device.address,
        port: device.port,
      });
      adapter = new NativeCastAdapter(id, (error) => {
        if (generation !== connectionGeneration) return;
        set({ error, busy: true });
        // Queue recovery even if the connection fails during the output handoff.
        void router
          .switchTo(router.local, false)
          .then(() => set({ device: null }))
          .catch((e) => set({ error: `${error}: ${String(e)}` }))
          .finally(() => set({ busy: false }));
      });
      await router.switchTo(adapter);
      set({ device });
    } catch (e) {
      adapter?.destroy();
      set({ error: String(e) });
    } finally {
      set({ busy: false });
    }
  },
  disconnect: async (router) => {
    if (get().busy) return;
    set({ busy: true });
    try {
      await router.switchTo(router.local, false);
      set({ device: null });
    } catch (e) {
      set({ error: String(e) });
    } finally {
      set({ busy: false });
    }
  },
}));
