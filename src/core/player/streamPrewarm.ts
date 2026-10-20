import type { Track } from "../types";

/** One background resolve at a time, including when the visible list changes. */
export class StreamPrewarmer {
  private pending: Track[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;

  constructor(private readonly resolve: (track: Track) => Promise<string>) {}

  prewarm(tracks: Track[]): void {
    this.cancel();
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.pending = tracks.filter((t) => t.uri && !t.meta?.noPlay).slice(0, 3);
      void this.run();
    }, 500);
  }

  cancel(): void {
    clearTimeout(this.timer);
    this.pending = [];
  }

  private async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.pending.length) {
        const track = this.pending.shift()!;
        // The shared resolver handles cache expiry and quality changes.
        try {
          await this.resolve(track);
        } catch {
          /* A click can retry. */
        }
      }
    } finally {
      this.running = false;
    }
  }
}
