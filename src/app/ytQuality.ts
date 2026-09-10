const KEY = "wave:yt-quality";
const MOBILE_KEY = "wave:yt-mobile-quality";

export type YtQuality = "low" | "medium" | "high" | "best";

const VALID: YtQuality[] = ["low", "medium", "high", "best"];

function load(key: string, fallback: YtQuality): YtQuality {
  try {
    const v = localStorage.getItem(key);
    return (VALID as string[]).includes(v ?? "") ? (v as YtQuality) : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, q: YtQuality): void {
  try {
    localStorage.setItem(key, q);
  } catch {
    
  }
}

export function loadYtQuality(): YtQuality {
  return load(KEY, "best");
}

export function saveYtQuality(q: YtQuality): void {
  save(KEY, q);
}

export function loadMobileYtQuality(): YtQuality {
  return load(MOBILE_KEY, "medium");
}

export function saveMobileYtQuality(q: YtQuality): void {
  save(MOBILE_KEY, q);
}

export type ConnectionKind = "wifi" | "cellular" | "unknown";

/** Тип сети через Network Information API (Chrome/WebView на Android). */
export function connectionKind(): ConnectionKind {
  try {
    const conn = (navigator as unknown as { connection?: { type?: string } })?.connection;
    const t = conn?.type?.toLowerCase() ?? "";
    if (t.includes("wifi")) return "wifi";
    if (t.includes("cellular") || t.includes("cell")) return "cellular";
    if (t.includes("ethernet")) return "wifi";
  } catch {}
  return "unknown";
}

/** Эффективное качество: на сотовой сети — мобильное, иначе обычное. */
export function resolveYtQuality(): YtQuality {
  return connectionKind() === "cellular" ? loadMobileYtQuality() : loadYtQuality();
}
