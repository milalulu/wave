// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockRejectedValue(new Error("no tauri")),
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
import { SearchView } from "./SearchView";
import type { Track } from "../core/types";

afterEach(() => cleanup());

const liked: Track[] = [
  { id: "y:1", provider: "youtube", uri: "u", title: "Moscow Never Sleeps", artist: "Dj Smash" },
];
const history: Track[] = [
  { id: "y:2", provider: "youtube", uri: "u", title: "Moscow Rain", artist: "Someone" },
];

function mockServices() {
  useApp.setState({
    services: {
      providers: [],
      library: { getLikedTracks: async () => liked },
      history: { getHistory: async () => history.map((track) => ({ track, playedAt: Date.now() })) },
    },
  } as never);
}

describe("SearchView suggestions", () => {
  it("показывает подсказки из лайков и истории при фокусе", async () => {
    mockServices();
    const onQuery = vi.fn();
    render(
      <I18nProvider>
        <SearchView query="" onQuery={onQuery} />
      </I18nProvider>,
    );
    const input = screen.getByPlaceholderText(/search/i);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "mosc" } });
    await waitFor(() => {
      expect(screen.getByText("Dj Smash — Moscow Never Sleeps")).toBeTruthy();
    });
    expect(screen.getByText("Someone — Moscow Rain")).toBeTruthy();
  });

  it("клик по подсказке подставляет запрос", async () => {
    mockServices();
    const onQuery = vi.fn();
    render(
      <I18nProvider>
        <SearchView query="" onQuery={onQuery} />
      </I18nProvider>,
    );
    const input = screen.getByPlaceholderText(/search/i) as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "mosc" } });
    await waitFor(() => {
      expect(screen.getByText("Someone — Moscow Rain")).toBeTruthy();
    });
    fireEvent.click(screen.getByText("Someone — Moscow Rain"));
    expect(onQuery).toHaveBeenCalledWith("Someone Moscow Rain");
    expect(input.value).toBe("Someone Moscow Rain");
  });
});
