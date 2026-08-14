const KEY = "wave:yt-quality";

export type YtQuality = "low" | "medium" | "high" | "best";

export function loadYtQuality(): YtQuality {
  try {
    const v = localStorage.getItem(KEY);
    return v === "low" || v === "medium" || v === "high" || v === "best" ? v : "best";
  } catch {
    return "best";
  }
}

export function saveYtQuality(q: YtQuality): void {
  try {
    localStorage.setItem(KEY, q);
  } catch {
    /* игнорируем переполнение localStorage */
  }
}
