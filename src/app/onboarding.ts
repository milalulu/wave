const COMPLETED_KEY = "wave:onboarding-completed";
const ARTISTS_KEY = "wave:onboarding-artists";

export function isOnboardingCompleted(): boolean {
  try {
    return localStorage.getItem(COMPLETED_KEY) === "true";
  } catch {
    return false;
  }
}

export function completeOnboarding(artistNames: string[]): void {
  try {
    localStorage.setItem(ARTISTS_KEY, JSON.stringify(artistNames));
    localStorage.setItem(COMPLETED_KEY, "true");
  } catch {
    // ignore
  }
}

export function loadOnboardingArtists(): string[] {
  try {
    const raw = localStorage.getItem(ARTISTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((a): a is string => typeof a === "string");
  } catch {
    return [];
  }
}
