/** Compressed media only; never allow a disk-cache recovery to consume unbounded RAM. */
export const MEDIA_MEMORY_LIMIT = 32 * 1024 * 1024;
export const MEDIA_MEMORY_TIMEOUT_MS = 8000;

export async function fetchMediaBlob(url: string, signal: AbortSignal): Promise<Blob> {
  const response = await fetch(url, { signal, headers: { Range: "bytes=0-" } });
  if (!response.ok) throw new Error(`audio recovery HTTP ${response.status}`);
  if (!response.body) throw new Error("audio recovery: empty response");
  const reader = response.body.getReader();
  const parts: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    if (Number(response.headers.get("content-length")) > MEDIA_MEMORY_LIMIT) {
      throw new Error("audio recovery: file exceeds memory limit");
    }
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MEDIA_MEMORY_LIMIT) throw new Error("audio recovery: file exceeds memory limit");
      parts.push(new Uint8Array(value));
    }
    signal.throwIfAborted();
    return new Blob(parts, { type: response.headers.get("content-type") ?? "application/octet-stream" });
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
