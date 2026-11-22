import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { playbackSource, type Track } from "../core/types";

import { sameRecording } from "../core/recordings/matching";

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
  bytes?: number;
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
  invalidateCache();
}

type DownloadIndex = { byId: Map<string, string>; byFile: Map<string, DownloadedFile> };
let indexCache: DownloadIndex | null = null;

function getIndex(): DownloadIndex {
  if (indexCache) return indexCache;
  const byId = new Map<string, string>();
  const byFile = new Map<string, DownloadedFile>();
  for (const f of downloadedFiles()) {
    if (f.trackId) byId.set(f.trackId, f.file);
    byFile.set(f.file, f);
  }
  indexCache = { byId, byFile };
  return indexCache;
}

function invalidateCache(): void {
  indexCache = null;
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
  bytes?: number,
): void {
  const files = downloadedFiles().filter((f) => f.file !== file);
  files.push({ file, trackId, provider, artist, title, coverUrl, coverFile, duration, album,
    ...(typeof bytes === "number" && bytes > 0 ? { bytes } : {}) });
  persist(files);
}

export function unregisterDownload(file: string): void {
  persist(downloadedFiles().filter((f) => f.file !== file));
}

export function isTrackDownloaded(trackId: string): boolean {
  return getIndex().byId.has(trackId);
}

export function downloadedFilePath(trackId: string): string | null {
  return getIndex().byId.get(trackId) ?? null;
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

// URL страницы (watch/track page), а не прямой медиафайл: качать напрямую нельзя,
// сначала нужен resolveUri провайдера (важно для Android без yt-dlp).
const INDIRECT_PATTERNS = [
  /youtube\.com\/watch/i,
  /music\.youtube\.com\/watch/i,
  /youtu\.be\//i,
  /soundcloud\.com\//i,
  /open\.spotify\.com\//i,
];

export function needsStreamResolve(url: string): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  if (lower.includes("api.soundcloud.com")) return false;
  if (lower.includes("googlevideo.com")) return false;
  if (/\.(mp3|m4a|ogg|opus|flac|wav|mp4|webm)(\?|#|$)/i.test(url)) return false;
  return INDIRECT_PATTERNS.some((re) => re.test(url));
}

export function localUriFor(track: Track): string | null {
  const file = findDownloadedFile(track, downloadedFiles());
  return file?.file ? convertFileSrc(file.file) : null;
}

export async function findMissingDownloads(paths: string[]): Promise<Set<string>> {
  const missing = new Set<string>();
  for (let offset = 0; offset < paths.length; offset += 100) {
    try {
      const result = await invoke<string[]>("missing_download_files", { paths: paths.slice(offset, offset + 100) });
      for (const path of result) missing.add(path);
    } catch { /* Availability is unknown outside the native app. */ }
  }
  return missing;
}

export function findDownloadedFile(track: Track, files: readonly DownloadedFile[]): DownloadedFile | undefined {
  track = playbackSource(track);
  const byId = files.find((f) => f.trackId === track.id);
  return byId ?? files.find((f) => sameRecording(track, {
    id: f.trackId ?? "", provider: f.provider ?? "local", uri: f.file,
    title: f.title ?? "", artist: f.artist, duration: f.duration,
  }));
}
