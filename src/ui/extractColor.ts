const cache = new Map<string, string>();
const MAX_CACHE = 60;

export function extractDominantColor(url: string): string | null {
  return cache.get(url) ?? null;
}

export function preloadDominantColor(url: string): void {
  if (!url || cache.has(url)) return;
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.referrerPolicy = "no-referrer";
  img.onload = () => {
    try {
      const canvas = document.createElement("canvas");
      const size = 32;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, size, size);
      const data = ctx.getImageData(0, 0, size, size).data;
      let r = 0, g = 0, b = 0, count = 0;
      for (let i = 0; i < data.length; i += 16) {
        r += data[i];
        g += data[i + 1];
        b += data[i + 2];
        count++;
      }
      if (count > 0) {
        r = Math.round(r / count);
        g = Math.round(g / count);
        b = Math.round(b / count);
      }
      const hex = `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
      cache.set(url, hex);
      if (cache.size > MAX_CACHE) {
        const first = cache.keys().next().value;
        if (first) cache.delete(first);
      }
    } catch {
      // CORS or security error
    }
  };
  img.src = url;
}
