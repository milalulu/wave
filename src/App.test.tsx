// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  Object.assign(globalThis, { __WAVE_DESKTOP_AGENT__: false });
  return { ready: false, init: vi.fn(), view: "home", setView: vi.fn(), navStack: ["home"], goBack: vi.fn(),
    onboardingCompleted: true, togglePlay: vi.fn(), next: vi.fn(), previous: vi.fn(), setVolume: vi.fn() };
});
vi.mock("./app/stores", () => ({ useApp: Object.assign((select: (s: unknown) => unknown) => select(state), { getState: () => state }) }));
vi.mock("@tauri-apps/api/app", () => ({ onBackButtonPress: vi.fn().mockResolvedValue({ unregister: vi.fn() }) }));
import App from "./App";

afterEach(() => { cleanup(); vi.clearAllMocks(); });
it("does not steal native button, select or editable keys for playback", () => {
  render(<><App /><button>Action</button><select><option>One</option></select><div contentEditable suppressContentEditableWarning>Editor</div></>);
  for (const el of document.querySelectorAll("button, select, [contenteditable]")) {
    fireEvent.keyDown(el, { code: "Space", key: " " });
    fireEvent.keyDown(el, { code: "ArrowRight", key: "ArrowRight" });
  }
  expect(state.togglePlay).not.toHaveBeenCalled();
  expect(state.next).not.toHaveBeenCalled();
  fireEvent.keyDown(window, { code: "Space", key: " " });
  expect(state.togglePlay).toHaveBeenCalledOnce();
});

it("keeps Ctrl+K available in text inputs but leaves editing arrows alone", () => {
  render(<><App /><input /></>);
  const input = document.querySelector("input")!;
  fireEvent.keyDown(input, { code: "ArrowRight", ctrlKey: true });
  expect(state.next).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { code: "KeyK", ctrlKey: true });
  expect(state.setView).toHaveBeenCalledWith("search");
});
