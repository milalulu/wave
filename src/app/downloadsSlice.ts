import type { StateCreator } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { playbackSource, type Track } from "../core/types";
import { t } from "../core/i18n";
import { downloadedFiles, registerDownload, needsStreamResolve, unregisterDownload } from "./offline";
import { isStreamingProvider } from "./platformSettings";
import type { AppState } from "./stores";
import type { MusicProvider } from "../core/providers/MusicProvider";

export async function resolveDownloadMedia(source: Track, providers: MusicProvider[]) {
  if (!isStreamingProvider(source.provider)) throw new Error("streaming source unavailable");
  let url = String(source.meta?.url ?? "") || String(source.meta?.audioUrl ?? "")
    || String(source.meta?.scUrl ?? "") || source.uri;
  if (!url) throw new Error("no source url");
  const provider = providers.find((entry) => entry.id === source.provider);
  if (source.provider === "soundcloud") {
    if (!provider) throw new Error("SoundCloud is unavailable");
    url = await provider.resolveUri(source);
  } else if (provider && needsStreamResolve(url)) {
    try { url = (await provider.resolveUri(source)) || url; } catch {}
  }
  const parsed = new URL(url);
  if (/\.m3u8$/i.test(parsed.pathname) && typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent)) {
    throw new Error(t("downloads").hlsDesktopOnly);
  }
  const mime = parsed.searchParams.get("mime");
  const extension = parsed.pathname.match(/\.(m4a|mp3|ogg|opus|flac|wav|webm)$/i)?.[1];
  const ext = extension?.toLowerCase() ?? (mime === "audio/webm" ? "webm"
    : mime === "audio/mp4" || /\.m3u8(?:[?#]|$)/i.test(url) ? "m4a" : "mp3");
  return { url, ext };
}

export interface DownloadItem {
  id: string;
  track: Track;
  status: "queued" | "running" | "done" | "error";
  error?: string;
  percent?: number;
  dir: string;
  filePath?: string;
  replacesFile?: string;
}

export interface DownloadsSlice {
  downloadTrack: (track: Track) => Promise<void>;
  downloadTracks: (tracks: readonly Track[], replacesFile?: string) => Promise<number>;
  downloads: DownloadItem[];
  downloading: boolean;
  clearDownloads: () => void;
  retryDownload: (id: string) => void;
  pumpDownloads: () => Promise<void>;
}

export const createDownloadsSlice: StateCreator<AppState, [], [], DownloadsSlice> = (set, get) => ({
  downloadTrack: async (track) => {
    await get().downloadTracks([track]);
  },

  downloadTracks: async (tracks, replacesFile) => {
    const available = tracks.filter((track) => isStreamingProvider(playbackSource(track).provider) && !track.meta?.noPlay);
    if (available.length === 0) return 0;
    let dir = "";
    try { dir = localStorage.getItem("wave-download-dir") ?? ""; } catch { /* Session defaults. */ }
    if (!dir) {
      try { dir = await invoke<string>("app_download_dir"); } catch { /* Offer the folder picker. */ }
    }
    if (!dir) {
      try {
        const picked = await open({ directory: true, multiple: false });
        if (typeof picked === "string") {
          dir = picked;
          try { localStorage.setItem("wave-download-dir", dir); } catch { /* Use for this batch. */ }
        }
      } catch { /* The user can select a directory later. */ }
    }
    if (!dir) {
      get().notify(t("player").downloadDirRequired);
      return 0;
    }
    const pending = new Set(get().downloads
      .filter((job) => job.dir === dir && (job.status === "queued" || job.status === "running"))
      .map((job) => playbackSource(job.track).id));
    const saved = new Set(downloadedFiles().flatMap((entry) => entry.trackId && entry.file !== replacesFile ? [entry.trackId] : []));
    const batch: DownloadItem[] = [];
    for (const track of available) {
      const source = playbackSource(get().services?.recordings?.resolve(track) ?? track);
      if (pending.has(source.id) || saved.has(source.id)) continue;
      pending.add(source.id);
      batch.push({ id: `dl:${Date.now()}:${Math.random().toString(36).slice(2)}`, track, status: "queued", dir, replacesFile });
    }
    if (!batch.length) {
      get().notify(t("downloads").dlAlreadyQueued);
      return 0;
    }
    set((state) => ({ downloads: [...state.downloads, ...batch] }));
    void get().pumpDownloads();
    return batch.length;
  },

  downloads: [],
  downloading: false,
  clearDownloads: () =>
    set((s) => ({
      downloads: s.downloads.filter((d) => d.status === "queued" || d.status === "running"),
    })),

  retryDownload: (id) => {
    set((s) => ({
      downloads: s.downloads.map((d) =>
        d.id === id && d.status === "error" ? { ...d, status: "queued", error: undefined, percent: 0 } : d,
      ),
    }));
    void get().pumpDownloads();
  },

  pumpDownloads: async () => {
    const s = get();
    if (!s.services || s.downloading) return;
    const next = s.downloads.find((d) => d.status === "queued");
    if (!next) return;
    set((prev) => ({
      downloading: true,
      downloads: prev.downloads.map((d) =>
        d.id === next.id ? { ...d, status: "running", percent: 0 } : d,
      ),
    }));
    const finish = (patch: Partial<DownloadItem>): void => {
      set((prev) => ({
        downloading: false,
        downloads: prev.downloads.map((d) =>
          d.id === next.id ? { ...d, ...patch } : d,
        ),
      }));
    };
    try {
      const source = playbackSource(s.services.recordings?.resolve(next.track) ?? next.track);
      const { url, ext } = await resolveDownloadMedia(source, s.services.providers);
      const safe = (v: string) => v.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80).trim() || "track";
      const stem = `${safe(next.track.artist ?? "")} - ${safe(next.track.title ?? "")}`;
      const occupied = new Set(downloadedFiles()
        .filter((file) => file.trackId !== source.id)
        .map((file) => file.file.replace(/\.[^./\\]+$/, "").toLowerCase()));
      let base = stem;
      for (let number = 2; occupied.has(`${next.dir}/${base}`.toLowerCase()); number++) {
        base = `${stem} (${number})`;
      }
      const outputPath = `${next.dir}/${base}.${ext}`;
      const bytes = await invoke<number>("yt_download", {
        url,
        outputPath,
        jobId: next.id,
      });

      let coverFile: string | undefined;
      const coverUrl = next.track.coverUrl;
      if (coverUrl && (coverUrl.startsWith("http://") || coverUrl.startsWith("https://"))) {
        const coverExt = coverUrl.includes(".png") ? ".png" : ".jpg";
        const coverPath = `${next.dir}/${base}${coverExt}`;
        try {
          await invoke("download_cover", { url: coverUrl, outputPath: coverPath });
          coverFile = coverPath;
        } catch {}
      }

      registerDownload(
        outputPath,
        next.track.artist,
        next.track.title,
        source.id,
        source.provider,
        coverUrl,
        coverFile,
        source.duration,
        next.track.album,
        bytes,
      );
      if (next.replacesFile && next.replacesFile !== outputPath) unregisterDownload(next.replacesFile);
      finish({ status: "done", percent: 100, filePath: outputPath });
    } catch (e) {
      finish({ status: "error", error: e instanceof Error ? e.message : String(e) });
    }
    void get().pumpDownloads();
  },
});
