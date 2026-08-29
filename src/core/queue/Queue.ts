import type { Track } from "../types";

export interface QueueOptions {
  rng?: () => number;
}

export class Queue {
  private tracks: Track[] = [];
  private history: Track[] = [];
  private order: number[] = [];
  private pos = -1;
  private shuffle = false;
  private rng: () => number;

  constructor(options: QueueOptions = {}) {
    this.rng = options.rng ?? Math.random;
  }

  get tracksList(): Track[] {
    return [...this.tracks];
  }

  get historyList(): Track[] {
    return [...this.history];
  }

  get length(): number {
    return this.tracks.length;
  }

  get isShuffle(): boolean {
    return this.shuffle;
  }

  get position(): number {
    return this.pos;
  }

  current(): Track | null {
    if (this.pos < 0 || this.pos >= this.order.length) return null;
    return this.tracks[this.order[this.pos]] ?? null;
  }

  
  currentIndex(): number {
    if (this.pos < 0 || this.pos >= this.order.length) return -1;
    return this.order[this.pos];
  }

  replace(tracks: Track[], startIndex = 0): void {
    this.tracks = [...tracks];
    this.history = [];
    this.rebuildOrder();
    this.pos = -1;
    if (this.tracks.length > 0) {
      let start = Math.min(Math.max(startIndex, 0), this.tracks.length - 1);
      let found = this.order.indexOf(start);
      if (found < 0) {
        start = this.tracks.length > 0 ? this.order[0] : -1;
        found = start >= 0 ? 0 : -1;
      }
      this.pos = found;
    }
    this.recordHistory();
  }

  append(track: Track): boolean {
    if (this.tracks.some((t) => t.id === track.id)) return false;
    this.tracks.push(track);
    const newIdx = this.tracks.length - 1;
    const hasCurrent = this.current() !== null;
    if (hasCurrent && this.shuffle) {
      
      
      const tailStart = this.pos + 1;
      const count = this.order.length - tailStart + 1;
      const insertPos = tailStart + Math.floor(this.rng() * count);
      this.order.splice(insertPos, 0, newIdx);
    } else {
      this.order.push(newIdx);
    }
    return true;
  }

  insertNext(track: Track): boolean {
    if (this.tracks.some((t) => t.id === track.id)) return false;
    this.tracks.push(track);
    const newIdx = this.tracks.length - 1;
    if (this.current() !== null) {
      const insertPos = this.pos + 1;
      this.order.splice(insertPos, 0, newIdx);
    } else {
      this.order.push(newIdx);
    }
    return true;
  }

  removeAt(trackIndex: number): Track | null {
    if (trackIndex < 0 || trackIndex >= this.tracks.length) return null;
    const currentTrack = this.current();
    const removingCurrent = trackIndex === this.currentIndex();
    const [removed] = this.tracks.splice(trackIndex, 1);
    this.rebuildOrder();
    if (this.tracks.length === 0) {
      this.pos = -1;
      return removed;
    }
    const curIndex = currentTrack ? this.tracks.indexOf(currentTrack) : -1;
    if (removingCurrent || curIndex < 0) {
      this.pos = 0;
    } else {
      this.pos = this.order.indexOf(curIndex);
      if (this.pos < 0) this.pos = 0;
    }
    return removed;
  }

  insertAt(trackIndex: number, track: Track): void {
    const idx = Math.min(Math.max(trackIndex, 0), this.tracks.length);
    if (this.tracks.some((t) => t.id === track.id)) return;
    const current = this.current();
    const currentOldIdx = current ? this.tracks.indexOf(current) : -1;
    this.tracks.splice(idx, 0, track);
    if (!this.shuffle) {
      this.order = this.tracks.map((_, i) => i);
    } else {
      this.order = this.tracks.map((_, i) => i);
      this.fisherYates(this.order);
    }
    if (current) {
      const ni = this.tracks.indexOf(current);
      this.pos = ni >= 0 ? this.order.indexOf(ni) : -1;
    } else {
      const ci = this.tracks.indexOf(track);
      this.pos = ci >= 0 ? this.order.indexOf(ci) : -1;
    }
    void currentOldIdx;
  }

  
  move(fromIndex: number, toIndex: number): void {
    if (fromIndex < 0 || fromIndex >= this.tracks.length) return;
    if (toIndex < 0 || toIndex >= this.tracks.length) return;
    if (fromIndex === toIndex) return;
    const current = this.current();
    const [t] = this.tracks.splice(fromIndex, 1);
    this.tracks.splice(toIndex, 0, t);
    this.rebuildOrder();
    if (current) {
      const idx = this.tracks.indexOf(current);
      this.pos = idx >= 0 ? this.order.indexOf(idx) : -1;
    } else {
      this.pos = -1;
    }
  }

  clear(): void {
    this.tracks = [];
    this.history = [];
    this.order = [];
    this.pos = -1;
  }

  
  replaceTrackFields(id: string, patch: Partial<Track>): boolean {
    let changed = false;
    for (let i = 0; i < this.tracks.length; i++) {
      if (this.tracks[i].id === id) {
        this.tracks[i] = { ...this.tracks[i], ...patch };
        changed = true;
      }
    }
    return changed;
  }

  
  replaceCurrent(track: Track): Track | null {
    const curIndex = this.currentIndex();
    if (curIndex < 0 || curIndex >= this.tracks.length) return null;
    this.tracks[curIndex] = track;
    return this.current();
  }

  setShuffle(on: boolean): void {
    const cur = this.current();
    this.shuffle = on;
    this.rebuildOrder();
    if (cur) {
      const idx = this.tracks.indexOf(cur);
      this.pos = idx >= 0 ? this.order.indexOf(idx) : -1;
    } else {
      this.pos = -1;
    }
  }

  next(): Track | null {
    if (this.pos < 0 || this.pos >= this.order.length) return null;
    if (this.pos + 1 >= this.order.length) return null;
    this.pos++;
    this.recordHistory();
    return this.current();
  }

  
  peekNext(): Track | null {
    if (this.pos < 0 || this.pos >= this.order.length) return null;
    if (this.pos + 1 >= this.order.length) return null;
    return this.tracks[this.order[this.pos + 1]] ?? null;
  }

  remainingCount(): number {
    if (this.pos < 0 || this.pos >= this.order.length) return 0;
    return this.order.length - this.pos - 1;
  }

  peekAhead(count: number): Track[] {
    if (this.pos < 0 || this.pos >= this.order.length) return [];
    const result: Track[] = [];
    for (let i = 1; i <= count && this.pos + i < this.order.length; i++) {
      const track = this.tracks[this.order[this.pos + i]];
      if (track) result.push(track);
    }
    return result;
  }

  previous(): Track | null {
    if (this.pos < 0 || this.pos >= this.order.length) return null;
    if (this.pos > 0) {
      this.pos--;
      this.recordHistory();
      return this.current();
    }
    return null;
  }

  restart(): Track | null {
    if (this.order.length === 0) return null;
    this.pos = 0;
    this.recordHistory();
    return this.current();
  }

  jumpToOrderPos(orderPos: number): Track | null {
    if (orderPos < 0 || orderPos >= this.order.length) return null;
    this.pos = orderPos;
    this.recordHistory();
    return this.current();
  }

  
  positionOf(trackIndex: number): number {
    return this.order.indexOf(trackIndex);
  }

  private rebuildOrder(): void {
    if (this.shuffle) {
      this.order = this.tracks.map((_, i) => i);
      this.fisherYates(this.order);
    } else {
      this.order = this.tracks.map((_, i) => i);
    }
  }

  private fisherYates(arr: number[]): void {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  private recordHistory(): void {
    const current = this.current();
    if (!current) return;
    const last = this.history[this.history.length - 1];
    if (last?.id === current.id) return;
    this.history.push(current);
    if (this.history.length > 100) this.history.shift();
  }
}
