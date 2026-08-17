const VALIDATE_TIMEOUT_MS = 3000;

function isYouTubeUrl(url: string): boolean {
  return (
    url.includes("googlevideo.com") ||
    url.includes("youtube.com") ||
    url.includes("youtu.be") ||
    url.includes("ytimg.com")
  );
}

export async function validateStreamUrl(url: string): Promise<void> {
  if (!url.startsWith("http://") && !url.startsWith("https://")) return;
  if (isYouTubeUrl(url)) return;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VALIDATE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`stream URL returned ${res.status}`);
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return;
    }
    throw err instanceof Error
      ? err
      : new Error("stream URL validation failed");
  } finally {
    clearTimeout(timer);
  }
}
