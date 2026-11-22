import { beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "zustand";
import { createDownloadsSlice, type DownloadItem } from "./downloadsSlice";
import { downloadedFiles, registerDownload } from "./offline";
import type { AppState } from "./stores";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), convertFileSrc: (p: string) => p }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

const item = (status: DownloadItem["status"]): DownloadItem => ({
  id: status, status, dir: "/music", filePath: status === "done" ? "/music/test.mp3" : undefined,
  track: { id: "test", provider: "test", title: "Test", uri: "https://example.test/test.mp3" },
});
const store = () => create<AppState>()(createDownloadsSlice as never);
beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });

describe("download job history", () => {
  it("resolves a SoundCloud track before downloading and uses an audio extension for HLS", async () => {
    const app = store();
    const url = "https://playback.media-streaming.soundcloud.cloud/sample.m3u8?token=example";
    const resolveUri = vi.fn().mockResolvedValue(url);
    const job = item("queued");
    job.track = { ...job.track, provider: "soundcloud", uri: "soundcloud:track:123" };
    app.setState({
      services: { providers: [{ id: "soundcloud", resolveUri }] } as unknown as AppState["services"],
      downloads: [job],
    });
    await app.getState().pumpDownloads();
    expect(resolveUri).toHaveBeenCalledWith(job.track);
    expect(invoke).toHaveBeenCalledWith("yt_download", {
      url, outputPath: "/music/track - Test.m4a", jobId: job.id,
    });
    expect(app.getState().downloads[0].status).toBe("done");
    expect(downloadedFiles()[0].file).toBe("/music/track - Test.m4a");
  });
  it("clears finished jobs without removing the offline library", () => {
    registerDownload("/music/test.mp3", "Artist", "Test", "test");
    const app = store();
    app.setState({ downloads: [item("done"), item("error"), item("running"), item("queued")] });
    app.getState().clearDownloads();
    expect(app.getState().downloads.map((d) => d.status)).toEqual(["running", "queued"]);
    expect(downloadedFiles()).toHaveLength(1);
  });

  it("preserves same-name downloads from different sources", async () => {
    const app = store();
    registerDownload("/music/track - Test.mp3", undefined, "Test", "other-version");
    const job = item("queued");
    job.track = { ...job.track, provider: "youtube" };
    app.setState({ services: { providers: [] } as unknown as AppState["services"], downloads: [job] });
    await app.getState().pumpDownloads();
    expect(downloadedFiles().map((file) => file.file)).toEqual([
      "/music/track - Test.mp3", "/music/track - Test (2).mp3",
    ]);
  });

  it("accepts a new download after the completed file is removed from the catalog", async () => {
    const app = store();
    const job = item("done");
    job.track = { ...job.track, provider: "youtube" };
    localStorage.setItem("wave-download-dir", job.dir);
    app.setState({ downloads: [job] });
    await app.getState().downloadTrack(job.track);
    expect(app.getState().downloads.map((entry) => entry.status)).toEqual(["done", "queued"]);
  });

  it("only retries failed jobs, leaving running and completed jobs alone", () => {
    const app = store();
    app.setState({ downloads: [item("done"), item("error"), item("running")] });
    for (const id of ["done", "error", "running"]) app.getState().retryDownload(id);
    expect(app.getState().downloads.map((d) => d.status)).toEqual(["done", "queued", "running"]);
  });
});
