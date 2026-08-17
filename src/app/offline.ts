import { convertFileSrc } from "@tauri-apps/api/core";
import type { Track } from "../core/types";

const DL_KEY = "wave-downloads";
const OFF_KEY = "wave-offline";

export interface DownloadedFile {
  file: string;
  artist?: string;
  title?: string;
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
  } catch {
    
  }
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

export function registerDownload(file: string, artist?: string, title?: string): void {
  try {
    const files = downloadedFiles().filter((f) => f.file !== file);
    files.push({ file, artist, title });
    localStorage.setItem(DL_KEY, JSON.stringify(files));
  } catch {
    
  }
}

export function unregisterDownload(file: string): void {
  try {
    localStorage.setItem(
      DL_KEY,
      JSON.stringify(downloadedFiles().filter((f) => f.file !== file)),
    );
  } catch {
    
  }
}

const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

export function localUriFor(track: Track): string | null {
  const title = norm(track.title);
  const artist = norm(track.artist ?? "");
  const files = downloadedFiles();
  
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
