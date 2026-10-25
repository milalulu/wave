/** Compressed media only; never allow media recovery to consume unbounded RAM. */
export const MEDIA_MEMORY_LIMIT = 32 * 1024 * 1024;
export const MEDIA_MEMORY_TIMEOUT_MS = 8000;

export async function fetchMediaBlob(url: string, signal: AbortSignal): Promise<Blob> {
  const parts: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  let total: number | undefined;
  let type = "application/octet-stream";
  do {
    signal.throwIfAborted();
    const response = await fetch(url, { signal, headers: { Range: `bytes=${size}-` } });
    if (!response.ok) throw new Error(`audio recovery HTTP ${response.status}`);
    if (!response.body) throw new Error("audio recovery: empty response");
    const reader = response.body.getReader();
    const start = size;
    let expected: number | undefined;
    try {
      if (start === 0) type = response.headers.get("content-type") ?? type;
      if (response.status === 206) {
        const range = response.headers.get("content-range")?.match(/^bytes (\d+)-(\d+)\/(\d+)$/i);
        if (!range) throw new Error("audio recovery: missing content range");
        const [, first, last, length] = range.map(Number);
        if (first !== start || last < first || last >= length || (total !== undefined && total !== length)) {
          throw new Error("audio recovery: inconsistent content range");
        }
        total = length;
        expected = last - first + 1;
      } else if (start > 0) {
        throw new Error("audio recovery: server ignored range");
      }
      if ((total ?? 0) > MEDIA_MEMORY_LIMIT || Number(response.headers.get("content-length")) + start > MEDIA_MEMORY_LIMIT) {
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
      if (expected !== undefined && size - start !== expected) throw new Error("audio recovery: truncated range");
      signal.throwIfAborted();
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  } while (total !== undefined && size < total);
  return new Blob(parts, { type });
}
