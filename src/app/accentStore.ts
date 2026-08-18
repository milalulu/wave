const KEY = "wave:accent-color";

export const ACCENT_PRESETS: { name: string; value: string }[] = [
  { name: "Purple", value: "#7c5cff" },
  { name: "Blue", value: "#3b82f6" },
  { name: "Cyan", value: "#06b6d4" },
  { name: "Teal", value: "#14b8a6" },
  { name: "Green", value: "#22c55e" },
  { name: "Lime", value: "#84cc16" },
  { name: "Yellow", value: "#eab308" },
  { name: "Orange", value: "#f97316" },
  { name: "Red", value: "#ef4444" },
  { name: "Pink", value: "#ec4899" },
  { name: "Rose", value: "#f43f5e" },
  { name: "Amber", value: "#f59e0b" },
];

export function loadAccentColor(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function saveAccentColor(color: string | null): void {
  try {
    if (color) {
      localStorage.setItem(KEY, color);
    } else {
      localStorage.removeItem(KEY);
    }
  } catch {}
}

export function applyAccentColor(color: string | null): void {
  const root = document.documentElement;
  if (color) {
    root.style.setProperty("--accent", color);
  } else {
    root.style.removeProperty("--accent");
  }
}
