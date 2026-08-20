import type { Track } from "../types";

const WINDOW_SIZE = 5;

export interface WeightedFeatures {
  bpm: number;
  tags: Map<string, number>;
  mood: string;
  year: number;
}

export class RollingContext {
  private window: Track[] = [];
  private seed: Track | null = null;

  setSeed(track: Track): void {
    this.seed = track;
    this.window = [];
  }

  addPlayed(track: Track): void {
    this.window.push(track);
    if (this.window.length > WINDOW_SIZE) {
      this.window.shift();
    }
  }

  removeLast(): void {
    this.window.pop();
  }

  getSeed(): Track | null {
    return this.seed;
  }

  getWindow(): readonly Track[] {
    return this.window;
  }

  getWeightedFeatures(): WeightedFeatures {
    const all = this.seed ? [...this.window, this.seed] : [...this.window];
    if (all.length === 0) {
      return { bpm: 0, tags: new Map(), mood: "", year: 0 };
    }

    const weights = this.computeWeights();
    const bpm = this.weightedAvgBpm(all, weights);
    const tags = this.weightedTags(all, weights);
    const mood = this.dominantMood(all, weights);
    const year = this.weightedAvgYear(all, weights);

    return { bpm, tags, mood, year };
  }

  private computeWeights(): number[] {
    const n = this.window.length;
    const weights: number[] = [];
    for (let i = 0; i < n; i++) {
      const distance = n - i;
      if (distance === 1) weights.push(0.5);
      else if (distance === 2) weights.push(0.3);
      else weights.push(0.2 / (n - 2));
    }
    if (this.seed) weights.push(0.2);
    const sum = weights.reduce((a, b) => a + b, 0);
    return sum > 0 ? weights.map((w) => w / sum) : weights.map(() => 1 / weights.length);
  }

  private weightedAvgBpm(tracks: Track[], weights: number[]): number {
    let num = 0;
    let den = 0;
    for (let i = 0; i < tracks.length; i++) {
      const bpm = (tracks[i].meta?.bpm as number) ?? 0;
      if (bpm > 0) {
        num += bpm * weights[i];
        den += weights[i];
      }
    }
    return den > 0 ? num / den : 0;
  }

  private weightedTags(tracks: Track[], weights: number[]): Map<string, number> {
    const tagWeights = new Map<string, number>();
    for (let i = 0; i < tracks.length; i++) {
      const tags = (tracks[i].meta?.tags as string[]) ?? [];
      for (const tag of tags) {
        tagWeights.set(tag, (tagWeights.get(tag) ?? 0) + weights[i]);
      }
    }
    return tagWeights;
  }

  private dominantMood(tracks: Track[], weights: number[]): string {
    const moodWeights = new Map<string, number>();
    for (let i = 0; i < tracks.length; i++) {
      const moods = (tracks[i].meta?.mood as string[]) ?? [];
      for (const m of moods) {
        moodWeights.set(m, (moodWeights.get(m) ?? 0) + weights[i]);
      }
    }
    let best = "";
    let bestScore = 0;
    for (const [mood, score] of moodWeights) {
      if (score > bestScore) {
        best = mood;
        bestScore = score;
      }
    }
    return best;
  }

  private weightedAvgYear(tracks: Track[], weights: number[]): number {
    let num = 0;
    let den = 0;
    for (let i = 0; i < tracks.length; i++) {
      const year = tracks[i].year ?? 0;
      if (year > 0) {
        num += year * weights[i];
        den += weights[i];
      }
    }
    return den > 0 ? Math.round(num / den) : 0;
  }
}
