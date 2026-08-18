const KEY = "wave:theme";
export type Theme = "dark" | "light" | "system" | "amoled";

const DARK_DEFAULT = true;

export function loadTheme(): Theme {
  try {
    const saved = localStorage.getItem(KEY) as Theme | null;
    if (saved === "dark" || saved === "light" || saved === "system" || saved === "amoled") {
      return saved;
    }
  } catch {
    
  }
  return DARK_DEFAULT ? "dark" : "light";
}

export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    
  }
}

export function isDarkSystem(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "amoled") {
    root.setAttribute("data-theme", "amoled");
  } else {
    const dark = theme === "system" ? isDarkSystem() : theme === "dark";
    if (dark) {
      root.removeAttribute("data-theme");
    } else {
      root.setAttribute("data-theme", "light");
    }
  }
}

export function onSystemThemeChange(cb: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => {};
  }
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const handler = (): void => cb();
  if (typeof mq.addEventListener === "function") {
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }
  mq.addListener(handler);
  return () => mq.removeListener(handler);
}
