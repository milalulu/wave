const KEY = "wave:discovery-rate";

export const DISCOVERY_MIN = 0;
export const DISCOVERY_MAX = 100;
export const DISCOVERY_DEFAULT = 30;

export function loadDiscoveryRate(): number {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return DISCOVERY_DEFAULT;
    const v = Number(raw);
    return v >= DISCOVERY_MIN && v <= DISCOVERY_MAX ? v : DISCOVERY_DEFAULT;
  } catch {
    return DISCOVERY_DEFAULT;
  }
}

export function saveDiscoveryRate(rate: number): void {
  try {
    localStorage.setItem(KEY, String(rate));
  } catch {
    
  }
}
