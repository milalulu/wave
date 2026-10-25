// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ search: vi.fn(), providers: [], complete: vi.fn() }));
vi.mock("../app/compose", () => ({ searchAll: mocks.search }));
vi.mock("../app/stores", () => ({ useApp: (select: (s: unknown) => unknown) => select({ services: { providers: mocks.providers }, completeOnboarding: mocks.complete }) }));
import { OnboardingView } from "./OnboardingView";
import { I18nProvider } from "./I18nContext";

afterEach(() => { cleanup(); vi.useRealTimers(); });
it("ignores a previous artist search after the query changes or is cleared", async () => {
  vi.useFakeTimers();
  let resolveOld!: (result: unknown[]) => void;
  mocks.search.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
    .mockResolvedValueOnce([{ artists: [{ id: "new", provider: "test", name: "New Artist" }] }]);
  render(<I18nProvider><OnboardingView /></I18nProvider>);
  const input = screen.getByRole("textbox");
  fireEvent.change(input, { target: { value: "old" } });
  await act(() => vi.advanceTimersByTimeAsync(400));
  fireEvent.change(input, { target: { value: "new" } });
  await act(() => vi.advanceTimersByTimeAsync(400));
  expect(screen.getByText("New Artist")).toBeTruthy();
  fireEvent.change(input, { target: { value: "" } });
  await act(async () => resolveOld([{ artists: [{ id: "old", provider: "test", name: "Old Artist" }] }]));
  expect(screen.queryByText("Old Artist")).toBeNull();
  expect(screen.queryByText("New Artist")).toBeNull();
});
