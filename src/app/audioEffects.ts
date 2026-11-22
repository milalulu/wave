import { sanitizeAudioValue } from "../core/player/equalizerPresets";

export interface AudioEffects {
  bassBoost: number;
  reverb: number;
  stereoWidth: number;
  spatialOrbit: number;
}

const KEY = "wave:audio-effects";

const DEFAULTS: AudioEffects = { bassBoost: 0, reverb: 0, stereoWidth: 0, spatialOrbit: 0 };

export function loadAudioEffects(): AudioEffects {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const data = JSON.parse(raw) as Record<string, unknown>;
    return {
      bassBoost: sanitizeAudioValue(data.bassBoost, 0, 15),
      reverb: sanitizeAudioValue(data.reverb, 0, 1),
      stereoWidth: sanitizeAudioValue(data.stereoWidth, -1, 1),
      spatialOrbit: sanitizeAudioValue(data.spatialOrbit, 0, 1),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveAudioEffects(fx: AudioEffects): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(fx));
  } catch {
    
  }
}
