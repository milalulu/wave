import type { StateCreator } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { Track } from "../core/types";
import { t } from "../core/i18n";
import { registerDownload, unregisterDownload, needsStreamResolve } from "./offline";
import type { AppState } from "./stores";

export interface DownloadItem {
  id: string;
  track: Track;
  status: "queued" | "running" | "done" | "error";
  error?: string;
  percent?: number;
  dir: string;
  filePath?: string;
}

export interface DownloadsSlice {
  downloadTrack: (track: Track) => Promise<void>;
  downloads: DownloadItem[];
  downloading: boolean;
  clearDownloads: () => void;
  retryDownload: (id: string) => void;
  pumpDownloads: () => Promise<void>;
}

export const createDownloadsSlice: StateCreator<AppState, [], [], DownloadsSlice> = (set, get) => ({
  downloadTrack: async (track) => {
    let dir = "";
    try {
      dir = localStorage.getItem("wave-download-dir") ?? "";
    } catch {
      dir = "";
    }
    if (!dir) {
      try {
        dir = await invoke<string>("app_download_dir");
      } catch {
        dir = "";
      }
    }
    if (!dir) {
      try {
        const picked = await open({ directory: true, multiple: false });
        if (typeof picked === "string") {
          dir = picked;
          try {
            localStorage.setItem("wave-download-dir", dir);
          } catch {

          }
        }
      } catch {

      }
    }
    if (!dir) {
      get().notify(t("player").downloadDirRequired);
      return;
    }
    const exists = get().downloads.some(
      (d) =>
        d.track.id === track.id &&
        d.dir === dir &&
        (d.status === "queued" || d.status === "running" || d.status === "done"),
    );
    if (exists) {
      get().notify(t("downloads").dlAlreadyQueued);
      return;
    }
    const id = `dl:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    set((s) => ({ downloads: [...s.downloads, { id, track, status: "queued", dir }] }));
    void get().pumpDownloads();
  },

  downloads: [],
  downloading: false,
  clearDownloads: () =>
    set((s) => {
      for (const d of s.downloads) {
        if (d.status === "done" && d.filePath) unregisterDownload(d.filePath);
      }
      return {
        downloads: s.downloads.filter((d) => d.status === "queued" || d.status === "running"),
      };
    }),

  retryDownload: (id) => {
    set((s) => ({
      downloads: s.downloads.map((d) =>
        d.id === id ? { ...d, status: "queued", error: undefined, percent: 0 } : d,
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
      let url =
        String(next.track.meta?.url ?? "") ||
        String(next.track.meta?.audioUrl ?? "") ||
        (next.track.uri ?? "");
      if (!url) throw new Error("no source url");
      // Страница вместо прямого файла: сначала резолвим стрим у провайдера,
      // иначе на Android без yt-dlp скачать нельзя, а yt-dlp может отсутствовать везде.
      if (needsStreamResolve(url)) {
        const provider = s.services?.providers.find((p) => p.id === next.track.provider);
        if (provider) {
          try {
            const direct = await provider.resolveUri(next.track);
            if (direct) url = direct;
          } catch {}
        }
      }
      const ext = url.includes(".m4a") ? "m4a" : "mp3";
      const safe = (v: string) => v.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80).trim() || "track";
      const filename = `${safe(next.track.artist ?? "")} - ${safe(next.track.title ?? "")}.${ext}`;
      const outputPath = `${next.dir}/${filename}`;
      await invoke("yt_download", {
        url,
        outputPath,
        jobId: next.id,
      });

      let coverFile: string | undefined;
      const coverUrl = next.track.coverUrl;
      if (coverUrl && (coverUrl.startsWith("http://") || coverUrl.startsWith("https://"))) {
        const coverExt = coverUrl.includes(".png") ? ".png" : ".jpg";
        const coverPath = `${next.dir}/${safe(next.track.artist ?? "")} - ${safe(next.track.title ?? "")}${coverExt}`;
        try {
          await invoke("download_cover", { url: coverUrl, outputPath: coverPath });
          coverFile = coverPath;
        } catch {}
      }

      registerDownload(
        outputPath,
        next.track.artist,
        next.track.title,
        next.track.id,
        next.track.provider,
        coverUrl,
        coverFile,
        next.track.duration,
        next.track.album,
      );
      finish({ status: "done", percent: 100, filePath: outputPath });
    } catch (e) {
      finish({ status: "error", error: e instanceof Error ? e.message : String(e) });
    }
    void get().pumpDownloads();
  },
});
