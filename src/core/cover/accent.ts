const ACCENT_KEY = "wave:accent";
const ACCENT_ENABLED_KEY = "wave:accent-enabled";

export interface AccentColors {
  accent: string;
  accent2: string;
  sourceUrl?: string;
  savedAt: number;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h * 6) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 1 / 6) [r, g, b] = [c, x, 0];
  else if (h < 2 / 6) [r, g, b] = [x, c, 0];
  else if (h < 3 / 6) [r, g, b] = [0, c, x];
  else if (h < 4 / 6) [r, g, b] = [0, x, c];
  else if (h < 5 / 6) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const to = (v: number): string =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("load failed"));
    img.src = src;
  });
}

/** Доминирующий цвет обложки → акцентная пара (accent/accent-2). */
export async function accentFromImage(src: string): Promise<AccentColors | null> {
  try {
    const img = await loadImage(src);
    const w = 40;
    const h = 40;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    let data: Uint8ClampedArray;
    try {
      data = ctx.getImageData(0, 0, w, h).data;
    } catch {
      return null; // CORS-tainted canvas
    }
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3] / 255;
      r += data[i] * a;
      g += data[i + 1] * a;
      b += data[i + 2] * a;
      n += a;
    }
    if (n < 1) return null;
    r = Math.round(r / n);
    g = Math.round(g / n);
    b = Math.round(b / n);
    const [hue, s, l] = rgbToHsl(r, g, b);
    const accent = hslToHex(hue, Math.max(s, 0.5), Math.min(Math.max(l, 0.36), 0.6));
    const accent2 = hslToHex(hue, Math.max(s * 0.75, 0.35), Math.min(l + 0.16, 0.72));
    return { accent, accent2, sourceUrl: src, savedAt: Date.now() };
  } catch {
    return null;
  }
}

export function applyAccent(colors: AccentColors | null): void {
  const root = document.documentElement.style;
  if (colors) {
    root.setProperty("--accent", colors.accent);
    root.setProperty("--accent-2", colors.accent2);
  } else {
    root.removeProperty("--accent");
    root.removeProperty("--accent-2");
  }
}

export function loadSavedAccent(): AccentColors | null {
  try {
    const raw = localStorage.getItem(ACCENT_KEY);
    return raw ? (JSON.parse(raw) as AccentColors) : null;
  } catch {
    return null;
  }
}

export function saveAccent(colors: AccentColors | null): void {
  try {
    if (colors) localStorage.setItem(ACCENT_KEY, JSON.stringify(colors));
    else localStorage.removeItem(ACCENT_KEY);
  } catch {}
}

export function isAccentEnabled(): boolean {
  try {
    return localStorage.getItem(ACCENT_ENABLED_KEY) !== "0";
  } catch {
    return true;
  }
}

export function setAccentEnabled(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(ACCENT_ENABLED_KEY, "1");
    else localStorage.setItem(ACCENT_ENABLED_KEY, "0");
  } catch {}
}
