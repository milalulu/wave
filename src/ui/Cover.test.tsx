// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const cached = vi.hoisted(() => ({ get: vi.fn<() => string | null>(() => null), invalidate: vi.fn() }));
vi.mock("../core/cover/CoverCache", () => ({ getCachedCover: cached.get, cacheCover: async () => null, invalidateCover: cached.invalidate }));
beforeEach(() => { cached.get.mockReturnValue(null); cached.invalidate.mockClear(); });
import { Cover } from "./Cover";
afterEach(cleanup);

it("replaces an unavailable cover without leaving a broken image or losing its accessible name", async () => {
  render(<Cover src="https://example.test/missing.jpg" alt="Album" className="track-cover" />);
  const image = await screen.findByRole("img", { name: "Album" });
  fireEvent.error(image);
  const fallback = screen.getByRole("img", { name: "Album" });
  expect(fallback.tagName).toBe("SPAN");
  expect(fallback.classList.contains("track-cover")).toBe(true);
});

it("tries the new cover after the previous track's artwork failed", async () => {
  const { rerender } = render(<Cover src="https://example.test/missing.jpg" alt="Album" />);
  fireEvent.error(await screen.findByRole("img", { name: "Album" }));
  rerender(<Cover src="https://example.test/new.jpg" alt="New album" />);
  const image = await screen.findByRole("img", { name: "New album" });
  expect(image.tagName).toBe("IMG");
  expect(image.getAttribute("src")).toBe("https://example.test/new.jpg");
});

it("retries the original URL when a cached image fails to decode", async () => {
  cached.get.mockReturnValue("data:image/png;base64,broken");
  render(<Cover src="https://example.test/original.jpg" alt="Cached album" />);
  fireEvent.error(await screen.findByRole("img", { name: "Cached album" }));
  expect(cached.invalidate).toHaveBeenCalledWith("https://example.test/original.jpg");
  expect(screen.getByRole("img", { name: "Cached album" }).getAttribute("src")).toBe("https://example.test/original.jpg");
});

it("does not keep the previous track artwork when the next track has none", () => {
  const { rerender } = render(<Cover src="https://example.test/first.jpg" alt="First" />);
  rerender(<Cover alt="Second" />);
  expect(screen.getByRole("img", { name: "Second" }).tagName).toBe("SPAN");
  expect(document.querySelector("img")).toBeNull();
});
