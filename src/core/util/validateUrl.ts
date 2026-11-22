import { isLocalMediaUri } from "./localMedia";

const VALIDATE_TIMEOUT_MS = 3000;

function isKnownStream(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return ["googlevideo.com", "youtube.com", "youtu.be", "ytimg.com", "sndcdn.com", "media-streaming.soundcloud.cloud"]
      .some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch { return false; }
}

export async function validateStreamUrl(url: string): Promise<void> {
  if (isLocalMediaUri(url)) return;
  if (!url.startsWith("http://") && !url.startsWith("https://")) return;
  if (isKnownStream(url)) return;
  if (url.includes("127.0.0.1:8299/audio")) return;

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
