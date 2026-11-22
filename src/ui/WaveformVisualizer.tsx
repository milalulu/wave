import type { PlayerEngine } from "../core/player/PlayerEngine";
import { Spectrum } from "./Spectrum";
import { EchoesMark } from "./EchoesMark";

/** Decorative fallback stays static and is never presented as measured audio. */
export function WaveformVisualizer({ engine, label }: { engine?: PlayerEngine; label: string }) {
  return <div className="echoes-signal" role="img" aria-label={label} data-signal={engine ? "audio" : "decorative"}>
    {engine ? <Spectrum engine={engine} /> : <EchoesMark />}
  </div>;
}
