const KEY = "wave:leveling";

export interface LevelingSettings {
  enabled: boolean;
  targetDb: number;
}

export const DEFAULT_LEVELING: LevelingSettings = { enabled: false, targetDb: -14 };

export function loadLeveling(): LevelingSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return { ...DEFAULT_LEVELING };
    const parsed = JSON.parse(raw) as Partial<LevelingSettings>;
    const enabled = parsed.enabled === true;
    const targetDb =
      typeof parsed.targetDb === "number" && Number.isFinite(parsed.targetDb)
        ? Math.min(-1, Math.max(-30, parsed.targetDb))
        : DEFAULT_LEVELING.targetDb;
    return { enabled, targetDb };
  } catch {
    return { ...DEFAULT_LEVELING };
  }
}

export function saveLeveling(s: LevelingSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {}
}
