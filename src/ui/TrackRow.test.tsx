// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";

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
import { TrackRow } from "./TrackRow";
import type { Track } from "../core/types";

afterEach(() => cleanup());

const track: Track = {
  id: "youtube:track:vid1",
  provider: "youtube",
  uri: "https://www.youtube.com/watch?v=vid1",
  title: "Song T",
  artist: "Artist A",
  duration: 210,
};

const renderRow = (t: Track = track) =>
  render(
    <I18nProvider>
      <TrackRow track={t} />
    </I18nProvider>,
  );

describe("TrackRow", () => {
  beforeEach(() => {
    useApp.setState({
      play: vi.fn().mockResolvedValue(undefined),
      toggleLike: vi.fn(),
    } as never);
  });

  it("показывает название, исполнителя и длительность", () => {
    renderRow();
    expect(screen.getByText("Song T")).toBeTruthy();
    expect(screen.getByText("Artist A")).toBeTruthy();
    expect(screen.getByText("3:30")).toBeTruthy();
  });

  it("клик по строке запускает воспроизведение", () => {
    renderRow();
    fireEvent.click(screen.getByRole("button", { name: "Song T — Artist A" }));
    expect(useApp.getState().play).toHaveBeenCalledWith([track], 0);
  });

  it("кнопка лайка вызывает toggleLike и не запускает play", () => {
    const { container } = renderRow();
    const likeBtn = container.querySelector(".track-actions .icon-btn:not(.more-btn)");
    expect(likeBtn).toBeTruthy();
    fireEvent.click(likeBtn!);
    expect(useApp.getState().toggleLike).toHaveBeenCalledWith(track);
    expect(useApp.getState().play).not.toHaveBeenCalled();
  });

  it("трек без аудио не запускается и показывает прочерк", () => {
    const noPlay: Track = { ...track, id: "x:noplay", meta: { noPlay: true } };
    renderRow(noPlay);
    expect(screen.getByText("—")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Song T — Artist A" }));
    expect(useApp.getState().play).not.toHaveBeenCalled();
  });

  it("кнопка меню открывает контекстное меню", () => {
    const { container } = renderRow();
    fireEvent.click(container.querySelector(".more-btn")!);
    expect(document.body.querySelector('[role="menu"]')).toBeTruthy();
  });
});
