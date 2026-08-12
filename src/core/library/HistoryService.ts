import type { HistoryEntry, Track } from "../types";
import type { Storage } from "../database/Storage";

export class HistoryService {
  constructor(private storage: Storage) {}

  async recordPlay(track: Track, playedAt = Date.now()): Promise<void> {
    await this.storage.addHistoryEntry({ track, playedAt });
  }

  async getHistory(limit = 50): Promise<HistoryEntry[]> {
    return this.storage.getHistory(limit);
  }

  async clear(): Promise<void> {
    return this.storage.clearHistory();
  }
}
