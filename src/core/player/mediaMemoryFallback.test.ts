import { afterEach, expect, it, vi } from "vitest";
import { fetchMediaBlob, MEDIA_MEMORY_LIMIT } from "./mediaMemoryFallback";
afterEach(() => vi.unstubAllGlobals());

it("keeps the media type and reads compressed bytes", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "audio/mp4" } })));
  const blob = await fetchMediaBlob("https://media/song", new AbortController().signal);
  expect(blob.type).toBe("audio/mp4");
  expect(blob.size).toBe(3);
  expect(fetch).toHaveBeenCalledWith("https://media/song", expect.objectContaining({ headers: { Range: "bytes=0-" } }));
});

it("rejects oversized content before reading and cancels the body", async () => {
  const cancel = vi.fn();
  const body = new ReadableStream({ cancel });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { headers: { "Content-Length": String(MEDIA_MEMORY_LIMIT + 1) } })));
  await expect(fetchMediaBlob("source", new AbortController().signal)).rejects.toThrow("memory limit");
  expect(cancel).toHaveBeenCalledOnce();
});

it("enforces the memory limit when content length is missing", async () => {
  const cancel = vi.fn();
  const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(MEDIA_MEMORY_LIMIT + 1)); }, cancel });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));
  await expect(fetchMediaBlob("source", new AbortController().signal)).rejects.toThrow("memory limit");
  expect(cancel).toHaveBeenCalledOnce();
});
