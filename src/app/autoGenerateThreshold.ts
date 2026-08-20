const KEY = "wave:auto-generate-threshold";

export const AUTO_GEN_MIN = 1;
export const AUTO_GEN_MAX = 20;
export const AUTO_GEN_DEFAULT = 3;

export function loadAutoGenerateThreshold(): number {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return AUTO_GEN_DEFAULT;
    const v = Number(raw);
    return v >= AUTO_GEN_MIN && v <= AUTO_GEN_MAX ? v : AUTO_GEN_DEFAULT;
  } catch {
    return AUTO_GEN_DEFAULT;
  }
}

export function saveAutoGenerateThreshold(threshold: number): void {
  try {
    localStorage.setItem(KEY, String(threshold));
  } catch {
    
  }
}
