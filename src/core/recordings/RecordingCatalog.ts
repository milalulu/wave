import { playbackSource, type Track, type TrackSource } from "../types";
import type { Storage } from "../database/Storage";
import { sameRecording, verifiedRecordingMatch } from "./matching";

export interface RecordingGroup {
  original: TrackSource;
  sources: TrackSource[];
  preferredId: string;
}

export function sourceOnly(track: Track): TrackSource {
  const { playbackSource: _source, ...source } = track;
  return source;
}

/** Source associations, persisted atomically. Automatic matches require known durations. */
export class RecordingCatalog {
  private groups: RecordingGroup[] = [];
  private index = new Map<string, RecordingGroup>();
  private writes: Promise<unknown> = Promise.resolve();
  constructor(private storage: Pick<Storage, "loadRecordingGroups" | "saveRecordingGroups">) {}

  async init(): Promise<void> {
    this.replace(await this.storage.loadRecordingGroups());
  }
  private replace(groups: RecordingGroup[]): void {
    const index = new Map<string, RecordingGroup>();
    for (const group of groups) {
      if (!group.original?.id || !Array.isArray(group.sources)
        || !group.sources.some((s) => s.id === group.original.id)
        || !group.sources.some((s) => s.id === group.preferredId)) throw new Error("Invalid recording preferences");
      for (const source of group.sources) {
        if (!source.id || index.has(source.id) || !sameRecording(group.original, source)) throw new Error("Conflicting recording preferences");
        index.set(source.id, group);
      }
    }
    this.groups = groups;
    this.index = index;
  }
  id(id: string): string { return this.index.get(id)?.original.id ?? id; }
  aliases(id: string): string[] { return this.index.get(id)?.sources.map((s) => s.id) ?? [id]; }
  sources(track: Track): TrackSource[] {
    return this.index.get(track.id)?.sources ?? [sourceOnly(track), ...(track.playbackSource ? [track.playbackSource] : [])];
  }
  resolve(track: Track, usePreference = true): Track {
    const group = this.index.get(track.id);
    if (!group) return track;
    const source = usePreference ? group.sources.find((s) => s.id === group.preferredId)! : playbackSource(track);
    const reason = track.meta?.recommendationReason;
    return { ...group.original, playbackSource: sourceOnly(source),
      ...(typeof reason === "string" ? { meta: { ...group.original.meta, recommendationReason: reason } } : {}) };
  }
  withSource(track: Track, source: TrackSource): Track {
    if (!sameRecording(track, source)) throw new Error("This source is a different recording");
    return { ...this.resolve(track), playbackSource: sourceOnly(source) };
  }
  select(track: Track, source: TrackSource): Promise<Track> {
    return this.associate(track, source, true);
  }
  associate(track: Track, source: TrackSource, preferSource = false): Promise<Track> {
    const work = this.writes.then(async () => {
      if (!sameRecording(track, source)) throw new Error("This source is a different recording");
      const existing = this.index.get(track.id), target = this.index.get(source.id);
      if (!preferSource && (!verifiedRecordingMatch(track, source) || (existing && existing === target))) return this.resolve(track);
      // Preserve the caller's already established library identity when groups join.
      const original = existing?.original ?? (!preferSource ? target?.original : undefined) ?? sourceOnly(track);
      const candidates = [...(existing?.sources ?? [sourceOnly(track)]), ...(target?.sources ?? []), sourceOnly(source)];
      const sources = [...new Map(candidates.map((s) => [s.id, s])).values()];
      if (!sources.every((s) => sameRecording(original, s))) throw new Error("Conflicting recording versions");
      const preferredId = preferSource ? source.id : existing?.preferredId ?? target?.preferredId ?? original.id;
      const group = { original, sources, preferredId };
      const next = [...this.groups.filter((g) => g !== existing && g !== target), group];
      await this.storage.saveRecordingGroups(next);
      this.replace(next);
      return this.resolve(track);
    });
    this.writes = work.catch(() => {});
    return work;
  }
}
