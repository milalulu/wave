import { measurePcmPower } from "../core/player/leveling";
import { fetchMediaBlob, MEDIA_MEMORY_TIMEOUT_MS } from "../core/player/mediaMemoryFallback";
import { isLocalMediaUri } from "../core/util/localMedia";
import type { Track } from "../core/types";
import { localUriFor } from "./offline";

const measurements = new Map<string, NonNullable<ReturnType<typeof measurePcmPower>>>();
let analysisQueue: Promise<void> = Promise.resolve();

export function measureLocalLoudness(tracks: readonly Track[], signal: AbortSignal): Promise<number | null> {
  const operation = analysisQueue.then(async () => {
    if (tracks.length === 0 || tracks.length > 40) return null;
    const inputs = tracks.map((track) => {
      if (!track.duration || track.duration > 15 * 60) return null;
      return isLocalMediaUri(track.uri) ? track.uri : localUriFor(track);
    });
    if (inputs.some((uri) => !uri)) return null;
    let energy = 0;
    let seconds = 0;
    for (const uri of inputs) {
      signal.throwIfAborted();
      if (!uri) return null;
      let value = measurements.get(uri);
      if (!value) {
        const blob = await fetchMediaBlob(uri, AbortSignal.any([signal, AbortSignal.timeout(MEDIA_MEMORY_TIMEOUT_MS)]));
        signal.throwIfAborted();
        const audio = await new OfflineAudioContext(1, 1, 16000).decodeAudioData(await blob.arrayBuffer());
        signal.throwIfAborted();
        const analyzed = measurePcmPower(audio);
        if (!analyzed) continue;
        value = analyzed;
        if (measurements.size >= 240) {
          const oldest = measurements.keys().next().value;
          if (oldest) measurements.delete(oldest);
        }
        measurements.set(uri, value);
      }
      energy += value.power * value.seconds;
      seconds += value.seconds;
    }
    return seconds > 0 ? 10 * Math.log10(energy / seconds) : null;
  });
  analysisQueue = operation.then(() => {}, () => {});
  return operation;
}
