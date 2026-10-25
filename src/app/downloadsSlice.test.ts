import { beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "zustand";
import { createDownloadsSlice, type DownloadItem } from "./downloadsSlice";
import { downloadedFiles, registerDownload } from "./offline";
import type { AppState } from "./stores";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), convertFileSrc: (p: string) => p }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

const item = (status: DownloadItem["status"]): DownloadItem => ({
  id: status, status, dir: "/music", filePath: status === "done" ? "/music/test.mp3" : undefined,
  track: { id: "test", provider: "test", title: "Test", uri: "https://example.test/test.mp3" },
});
const store = () => create<AppState>()(createDownloadsSlice as never);
beforeEach(() => localStorage.clear());

describe("download job history", () => {
  it("clears finished jobs without removing the offline library", () => {
    registerDownload("/music/test.mp3", "Artist", "Test", "test");
    const app = store();
    app.setState({ downloads: [item("done"), item("error"), item("running"), item("queued")] });
    app.getState().clearDownloads();
    expect(app.getState().downloads.map((d) => d.status)).toEqual(["running", "queued"]);
    expect(downloadedFiles()).toHaveLength(1);
  });

  it("only retries failed jobs, leaving running and completed jobs alone", () => {
    const app = store();
    app.setState({ downloads: [item("done"), item("error"), item("running")] });
    for (const id of ["done", "error", "running"]) app.getState().retryDownload(id);
    expect(app.getState().downloads.map((d) => d.status)).toEqual(["done", "queued", "running"]);
  });
});
