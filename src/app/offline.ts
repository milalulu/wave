import { convertFileSrc } from "@tauri-apps/api/core";
import type { Track } from "../core/types";

const DL_KEY = "wave-downloads";
const OFF_KEY = "wave-offline";

export interface DownloadedFile {
  file: string;
  trackId?: string;
  provider?: string;
  artist?: string;
  title?: string;
  coverUrl?: string;
  coverFile?: string;
  duration?: number;
  album?: string;
}

export function offlineEnabled(): boolean {
  try {
    return localStorage.getItem(OFF_KEY) === "1";
  } catch {
    return false;
  }
}

export function setOfflineEnabled(on: boolean): void {
  try {
    localStorage.setItem(OFF_KEY, on ? "1" : "0");
  } catch {}
}

export function downloadedFiles(): DownloadedFile[] {
  try {
    const raw = localStorage.getItem(DL_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as DownloadedFile[]) : [];
  } catch {
    return [];
  }
}

function persist(files: DownloadedFile[]): void {
  try {
    localStorage.setItem(DL_KEY, JSON.stringify(files));
  } catch {}
}

export function registerDownload(
  file: string,
  artist?: string,
  title?: string,
  trackId?: string,
  provider?: string,
  coverUrl?: string,
  coverFile?: string,
  duration?: number,
  album?: string,
): void {
  const files = downloadedFiles().filter((f) => f.file !== file);
  files.push({ file, trackId, provider, artist, title, coverUrl, coverFile, duration, album });
  persist(files);
}

export function unregisterDownload(file: string): void {
  persist(downloadedFiles().filter((f) => f.file !== file));
}

export function isTrackDownloaded(trackId: string): boolean {
  return downloadedFiles().some((f) => f.trackId === trackId);
}

export function downloadedFilePath(trackId: string): string | null {
  const f = downloadedFiles().find((d) => d.trackId === trackId);
  return f?.file ?? null;
}

export function downloadedTrackToTrack(df: DownloadedFile): Track {
  const cover = df.coverFile
    ? convertFileSrc(df.coverFile)
    : df.coverUrl ?? undefined;
  return {
    id: `local:${df.trackId ?? encodeURIComponent(df.file)}`,
    provider: df.provider ?? "local",
    uri: convertFileSrc(df.file),
    title: df.title ?? "Unknown",
    artist: df.artist,
    album: df.album,
    coverUrl: cover,
    duration: df.duration,
    meta: { noPlay: false, url: convertFileSrc(df.file) },
  };
}

const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

export function localUriFor(track: Track): string | null {
  const files = downloadedFiles();

  const byId = files.find((f) => f.trackId === track.id);
  if (byId?.file) return convertFileSrc(byId.file);

  const title = norm(track.title);
  const artist = norm(track.artist ?? "");

  const exact = files.filter((f) => {
    const ft = norm(f.title ?? "");
    const fa = norm(f.artist ?? "");
    if (ft && ft === title) return !artist || !fa || fa === artist;
    return false;
  });
  if (exact[0]?.file) return convertFileSrc(exact[0].file);

  const loose = files.find((f) => {
    const ft = norm(f.title ?? "");
    const fa = norm(f.artist ?? "");
    if (!ft || !fa) return false;
    if (fa !== artist) return false;
    return ft.includes(title) || title.includes(ft);
  });
  return loose?.file ? convertFileSrc(loose.file) : null;
}
