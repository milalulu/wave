import type { Track } from "../types";

export type LocalUriFn = (path: string) => string;

const assetSchemeLocalUri: LocalUriFn = (path) =>
  `asset://localhost/${path
    .split("/")
    .filter((s) => s.length > 0)
    .map(encodeURIComponent)
    .join("/")}`;

export function localUri(path: string, toUri: LocalUriFn = assetSchemeLocalUri): string {
  return toUri(path);
}

export function localPathFromUri(uri: string): string | null {
  if (uri.startsWith("http://asset.localhost/")) {
    const decoded = decodeURIComponent(uri.slice("http://asset.localhost/".length));
    return decoded.length > 0 ? decoded : null;
  }
  if (uri.startsWith("asset://localhost/")) {
    const raw = uri.slice("asset://localhost/".length);
    const decoded = raw.split("/").map(decodeURIComponent).join("/");
    return decoded.startsWith("/") ? decoded : `/${decoded}`;
  }
  return null;
}

export function buildM3U(tracks: Track[]): string {
  const lines = ["#EXTM3U"];
  for (const t of tracks) {
    const title = t.title ?? "";
    const label = t.artist ? `${t.artist} - ${title}` : title;
    const dur = t.duration && t.duration > 0 ? Math.round(t.duration) : -1;
    lines.push(`#EXTINF:${dur},${label.replace(/,/g, "")}`);
    const localPath = localPathFromUri(t.uri);
    if (localPath) lines.push(localPath);
    else if (t.uri.startsWith("http://") || t.uri.startsWith("https://")) lines.push(t.uri);
    else lines.push(`# WAVE-ONLY:${t.provider}:${t.id} ${label}`);
  }
  return lines.join("\n");
}

export function parseM3U(text: string, toUri: LocalUriFn = assetSchemeLocalUri): Track[] {
  const tracks: Track[] = [];
  let pending: { duration?: number; label?: string } | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#EXTINF:")) {
      const rest = line.slice(8);
      const comma = rest.indexOf(",");
      const duration = comma >= 0 ? Number(rest.slice(0, comma)) : NaN;
      const label = comma >= 0 ? rest.slice(comma + 1) : "";
      pending = { duration: Number.isFinite(duration) && duration > 0 ? duration : undefined, label };
      continue;
    }
    if (line.startsWith("#")) continue;
    const label = pending?.label ?? "";
    let artist: string | undefined;
    let title = label;
    if (label.includes(" - ")) {
      const idx = label.indexOf(" - ");
      artist = label.slice(0, idx);
      title = label.slice(idx + 3);
    }
    tracks.push({
      id: `local:${line}`,
      provider: "local",
      uri:
        line.startsWith("asset://") || line.startsWith("http://asset.localhost/")
          ? line
          : line.startsWith("/")
            ? toUri(line)
            : line,
      title: title || line.split("/").pop() || line,
      artist,
      duration: pending?.duration,
    });
    pending = null;
  }
  return tracks;
}
