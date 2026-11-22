import type { LyricsLine } from "../core/lyrics/LyricsService";
import { reactions, type LyricsCue } from "./lyricsDirection";
import { motifAtmosphere, type Atmosphere } from "./lyricsMotifs";

const durations: Record<Atmosphere, number> = {
  rain: 4.4, snow: 5.2, storm: 4.5, ocean: 4.7, embers: 4.1, cosmos: 5.1, dawn: 4.6, fog: 4.8, leaves: 4.5,
};

export type SceneEvent = { kind: Atmosphere; variant: number; time: number; end: number; seed: number };
export const lyricLength = (text: string) => Array.from(text.replace(/\s/gu, "")).length;
export const sweepLength = (start: number, end?: number) => Math.max(0.25, (end !== undefined && end > start ? end - start : 3) - 0.16);
export const firstWordOffset = (words?: LyricsLine["words"]) => -(words?.map((word) => word.text).join("").match(/^\s*/u)?.[0].length ?? 0);

function cueTime(line: LyricsLine, cue: LyricsCue, end?: number) {
  if (line.time === undefined) return;
  if (!line.words?.length) {
    const text = line.text.trim();
    return line.time + lyricLength(text.slice(0, cue.start)) / Math.max(1, lyricLength(text)) * sweepLength(line.time, end);
  }
  let offset = firstWordOffset(line.words);
  for (const word of line.words) {
    const start = offset;
    offset += word.text.length;
    if (cue.start < start || cue.end > offset) continue;
    const wordEnd = word.end ?? Math.min(end ?? Infinity, word.time + 0.55);
    return word.time + lyricLength(word.text.slice(0, cue.start - start)) / Math.max(1, lyricLength(word.text))
      * Math.max(0.06, wordEnd - word.time);
  }
}

export function planAtmospheres(lines: LyricsLine[], cues: LyricsCue[][], duration?: number) {
  const schedule: SceneEvent[] = [];
  let nextTime = duration;
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index];
    for (const cue of cues[index]) {
      const kind = motifAtmosphere(cue.motif);
      if (!kind) continue;
      const time = cueTime(line, cue, nextTime);
      if (time === undefined) continue;
      const variant = reactions.indexOf(cue.reaction);
      schedule.push({ kind, variant, time, end: time + durations[kind], seed: Math.imul(index + 1, 1013) + cue.start * 67 + variant });
    }
    if (line.time !== undefined && line.text.trim()) nextTime = line.time;
  }
  const spaced: SceneEvent[] = [];
  for (const event of schedule.sort((a, b) => a.time - b.time)) {
    const previous = spaced[spaced.length - 1];
    if (previous && event.time < previous.time + (previous.kind === event.kind ? 1.7 : 1.1)) continue;
    spaced.push(event);
  }
  return spaced;
}

export function activeAtmospheres(schedule: SceneEvent[], position: number) {
  let low = 0;
  let high = schedule.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (schedule[mid].time <= position) low = mid + 1;
    else high = mid;
  }
  return schedule.slice(Math.max(0, low - 2), low).filter((event) => position < event.end);
}
