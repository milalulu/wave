export function streamUrlExpiry(url: string, depth = 0): number | null {
  if (depth > 3) return null;
  try {
    const u = new URL(url);
    const inner = u.searchParams.get("url");
    if (inner) return streamUrlExpiry(inner, depth + 1);
    const value = u.searchParams.get("expire") ?? u.searchParams.get("Expires")
      ?? /\/expire\/(\d+)(?:\/|$)/.exec(u.pathname)?.[1];
    const seconds = Number(value);
    return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 - 60_000 : null;
  } catch { return null; }
}
