export interface AudioEffects {
  bassBoost: number;
  reverb: number;
  stereoWidth: number;
}

const KEY = "wave:audio-effects";

const DEFAULTS: AudioEffects = { bassBoost: 0, reverb: 0, stereoWidth: 0 };

export function loadAudioEffects(): AudioEffects {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const data = JSON.parse(raw) as Record<string, unknown>;
    return {
      bassBoost: typeof data.bassBoost === "number" ? Math.min(Math.max(data.bassBoost, 0), 15) : 0,
      reverb: typeof data.reverb === "number" ? Math.min(Math.max(data.reverb, 0), 1) : 0,
      stereoWidth: typeof data.stereoWidth === "number" ? Math.min(Math.max(data.stereoWidth, -1), 1) : 0,
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
