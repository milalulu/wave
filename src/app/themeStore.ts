const KEY = "wave:theme";
export type Theme = "dark" | "light";

const DARK_DEFAULT = true;

export function loadTheme(): Theme {
  try {
    const saved = localStorage.getItem(KEY) as "dark" | "light" | null;
    if (saved === "dark" || saved === "light") {
      return saved;
    }
  } catch {
    //
  }
  return DARK_DEFAULT ? "dark" : "light";
}

export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    //
  }
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "light") {
    root.setAttribute("data-theme", "light");
  } else {
    root.removeAttribute("data-theme");
  }
}
