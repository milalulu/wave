import type { Track } from "../types";

export const PREWARM_COUNT = 3;

// Пауза гасит промежуточные списки (набор поискового запроса, быстрые переходы),
// чтобы не тратить слоты yt-dlp на треки, которые пользователь уже пролистал.
export const PREWARM_DELAY_MS = 500;

type Resolver = (track: Track) => Promise<string>;

class StreamPrewarmer {
  private resolver: Resolver | null = null;
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private warmed = new Set<string>();

  setResolver(resolver: Resolver | null): void {
    this.resolver = resolver;
    this.reset();
  }

  prewarm(tracks: Track[], count = PREWARM_COUNT): void {
    if (!this.resolver) return;
    const targets = tracks.filter((t) => t.uri && !this.warmed.has(t.id)).slice(0, count);
    const generation = ++this.generation;
    clearTimeout(this.timer);
    if (targets.length === 0) return;
    this.timer = setTimeout(() => void this.run(targets, generation), PREWARM_DELAY_MS);
  }

  reset(): void {
    this.generation += 1;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.warmed.clear();
  }

  // Последовательно: резолв по клику важнее прогрева и не должен ждать в очереди за ним.
  private async run(tracks: Track[], generation: number): Promise<void> {
    for (const track of tracks) {
      if (generation !== this.generation || !this.resolver) return;
      this.warmed.add(track.id);
      try {
        await this.resolver(track);
      } catch {
        this.warmed.delete(track.id);
      }
    }
  }
}

export const streamPrewarmer = new StreamPrewarmer();
