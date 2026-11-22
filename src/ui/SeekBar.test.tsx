// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ position: 12, duration: 30, snapshot: { state: "paused", speed: 1 }, seek: vi.fn() }));
vi.mock("../app/stores", () => ({ useApp: (select: (s: unknown) => unknown) => select(state) }));
import { SeekBar } from "./SeekBar";
import { I18nProvider } from "./I18nContext";
afterEach(cleanup);
it("uses actual stream duration for a preview instead of the full catalog duration", () => {
  render(<I18nProvider><SeekBar track={{ id: "test", provider: "itunes", uri: "preview", title: "Song", duration: 240 }} /></I18nProvider>);
  expect((screen.getByRole("slider") as HTMLInputElement).max).toBe("30");
  expect(screen.getByText("0:30")).toBeTruthy();
});
