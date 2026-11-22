// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ConfirmDialog } from "./ConfirmDialog";
import { I18nProvider } from "./I18nContext";
afterEach(cleanup);
it("keeps keyboard focus within a destructive confirmation and cancels on Escape", () => {
  const cancel = vi.fn();
  render(<I18nProvider><ConfirmDialog message="Clear queue?" onConfirm={vi.fn()} onCancel={cancel} /></I18nProvider>);
  const dialog = screen.getByRole("dialog", { name: "Clear queue?" });
  const buttons = dialog.querySelectorAll("button");
  expect(document.activeElement).toBe(buttons[0]);
  fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(buttons[1]);
  fireEvent.keyDown(window, { key: "Tab" });
  expect(document.activeElement).toBe(buttons[0]);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(cancel).toHaveBeenCalledOnce();
});

it("returns focus to the initiating control on dismissal", () => {
  const opener = document.createElement("button");
  document.body.append(opener);
  opener.focus();
  const { unmount } = render(<I18nProvider><ConfirmDialog message="Clear?" onConfirm={vi.fn()} onCancel={vi.fn()} /></I18nProvider>);
  unmount();
  expect(document.activeElement).toBe(opener);
  opener.remove();
});
