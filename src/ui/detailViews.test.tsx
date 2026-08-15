// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue({}),
  convertFileSrc: (p: string) => p,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({ listen: vi.fn().mockResolvedValue(() => {}) })),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn().mockResolvedValue(null),
  save: vi.fn().mockResolvedValue(null),
}));
vi.mock("@tauri-apps/plugin-sql", () => ({
  default: { load: vi.fn() },
}));
vi.mock("@tauri-apps/plugin-global-shortcut", () => ({
  register: vi.fn(),
  unregisterAll: vi.fn(),
}));

import { useApp } from "../app/stores";
import { I18nProvider } from "./I18nContext";
import { AlbumDetailView } from "./AlbumDetailView";
import { ArtistDetailView } from "./ArtistDetailView";
import type { Album, AlbumDetail, ArtistDetail, Track } from "../core/types";

afterEach(() => cleanup());

const track = (id: string, title: string, artist: string): Track => ({
  id,
  title,
  uri: "",
  artist,
  album: "Test Album",
  duration: 210,
  provider: "itunes",
  coverUrl: "",
});

const albumDetail: AlbumDetail = {
  album: {
    id: "a1",
    title: "Test Album",
    artist: "Test Artist",
    provider: "itunes",
    coverUrl: "",
    year: 2024,
  },
  tracks: [track("t1", "Track One", "Test Artist"), track("t2", "Track Two", "Test Artist")],
};

const artistDetail: ArtistDetail = {
  artist: {
    id: "ar1",
    name: "Test Artist",
    provider: "itunes",
    coverUrl: "",
  },
  topTracks: [track("t1", "Track One", "Test Artist")],
  albums: [] as Album[],
};

describe("detail views smoke render", () => {
  it("AlbumDetailView renders album title, artist and tracks", () => {
    useApp.setState({ albumDetail });
    render(
      <I18nProvider>
        <AlbumDetailView />
      </I18nProvider>,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Test Album");
    expect(screen.getAllByText("Test Artist").length).toBeGreaterThan(0);
    expect(screen.getByText("Track One")).toBeTruthy();
    expect(screen.getByText("Track Two")).toBeTruthy();
  });

  it("AlbumDetailView shows fallback when no detail is loaded", () => {
    useApp.setState({ albumDetail: null });
    render(
      <I18nProvider>
        <AlbumDetailView />
      </I18nProvider>,
    );
    expect(screen.getByText("Unknown")).toBeTruthy();
  });

  it("ArtistDetailView renders artist name and top tracks", () => {
    useApp.setState({ artistDetail });
    render(
      <I18nProvider>
        <ArtistDetailView />
      </I18nProvider>,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Test Artist");
    expect(screen.getByText("Track One")).toBeTruthy();
  });
});
