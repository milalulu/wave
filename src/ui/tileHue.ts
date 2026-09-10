import type { CSSProperties } from "react";

/** Детерминированный hue 0–359 из строки (djb2). */
export function tileHue(name: string): number {
  let h = 5381;
  for (let i = 0; i < name.length; i++) {
    h = ((h << 5) + h + name.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 360;
}

/** CSS-переменная для цветного плейсхолдера обложки. */
export function tileStyle(name?: string | null): CSSProperties {
  if (!name) return {};
  return { "--tile-h": String(tileHue(name)) } as CSSProperties;
}
