// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  snapshot: { current: null as null | {id: string; title: string; artist: string}, state: "paused", queue: [], shuffle: false, repeat: "off" },
  likedIds: new Set(), position: 0, duration: 0, lyricsOpen: false,
  toggleLyrics: vi.fn(), seek: vi.fn(), togglePlay: vi.fn(),
}));
vi.mock("../app/stores", () => ({ useApp: (select: (s: unknown) => unknown) => select(state) }));
vi.mock("./QueueView", () => ({ QueueView: () => <div>Queue contents</div> }));
import { EchoesHome } from "./EchoesHome";
import { I18nProvider } from "./I18nContext";
import { setLocale } from "../core/i18n";
beforeEach(() => { setLocale("en"); state.snapshot.current = null; state.snapshot.state = "paused"; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("lets a desktop listener hide and restore the contextual queue without navigating away", () => {
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  const navigate = vi.fn();
  render(<I18nProvider><EchoesHome onNavigate={navigate} /></I18nProvider>);
  const toggle = screen.getAllByRole("button", { name: "Queue" })[0];
  expect(screen.getByRole("complementary", { name: "Queue" })).toBeTruthy();
  fireEvent.click(toggle);
  expect(screen.queryByRole("complementary", { name: "Queue" })).toBeNull();
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(toggle);
  expect(screen.getByText("Queue contents")).toBeTruthy();
  expect(navigate).not.toHaveBeenCalled();
});

it("opens the existing full queue screen on a phone instead of toggling an invisible desktop panel", () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  const navigate = vi.fn();
  render(<I18nProvider><EchoesHome onNavigate={navigate} /></I18nProvider>);
  fireEvent.click(screen.getAllByRole("button", { name: "Queue" })[0]);
  expect(navigate).toHaveBeenCalledWith("queue");
});

it("keeps the cover and transport consistent with playback state, including buffering", () => {
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  state.snapshot.current = { id: "actual-track", title: "Track", artist: "Artist" };
  state.snapshot.state = "playing";
  const tree = () => <I18nProvider><EchoesHome onNavigate={() => {}} /></I18nProvider>;
  const { rerender } = render(tree());
  expect(screen.getAllByRole("button", { name: "Pause" })).toHaveLength(2);
  state.snapshot.state = "paused";
  rerender(tree());
  expect(screen.getAllByRole("button", { name: /^Play$/ })).toHaveLength(2);
  state.snapshot.state = "loading";
  rerender(tree());
  const loadingButtons = screen.getAllByRole("button", { name: /loading/i });
  expect(loadingButtons).toHaveLength(2);
  for (const button of loadingButtons) expect((button as HTMLButtonElement).disabled).toBe(true);
});
