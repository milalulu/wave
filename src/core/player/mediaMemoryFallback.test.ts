import { afterEach, expect, it, vi } from "vitest";
import { fetchMediaBlob, MEDIA_MEMORY_LIMIT } from "./mediaMemoryFallback";
afterEach(() => vi.unstubAllGlobals());

it("assembles capped partial responses without truncating local audio", async () => {
  const fetcher = vi.fn()
    .mockResolvedValueOnce(new Response(new Uint8Array([1, 2]), { status: 206, headers: { "Content-Range": "bytes 0-1/4", "Content-Type": "audio/wav" } }))
    .mockResolvedValueOnce(new Response(new Uint8Array([3, 4]), { status: 206, headers: { "Content-Range": "bytes 2-3/4" } }));
  vi.stubGlobal("fetch", fetcher);
  const blob = await fetchMediaBlob("asset://localhost/song.wav", new AbortController().signal);
  expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([1, 2, 3, 4]);
  expect(blob.type).toBe("audio/wav");
  expect(fetcher.mock.calls[1][1].headers.Range).toBe("bytes=2-");
});

it.each(["bytes 1-2/4", "bytes 0-4/4", "invalid"])("rejects inconsistent range %s", async (range) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2]), { status: 206, headers: { "Content-Range": range } })));
  await expect(fetchMediaBlob("source", new AbortController().signal)).rejects.toThrow(/range/);
});

it("rejects an oversized total even when the first range is tiny", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Uint8Array([1]), { status: 206, headers: { "Content-Range": `bytes 0-0/${MEDIA_MEMORY_LIMIT + 1}` } })));
  await expect(fetchMediaBlob("source", new AbortController().signal)).rejects.toThrow("memory limit");
});

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
